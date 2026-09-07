import copy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from tech_scout_acquisition.models import AcquisitionBlocked
from tech_scout_acquisition.parsers import (
    assignee_matches,
    domestic_candidate,
    parse_patent,
    parse_results,
)
from tech_scout_acquisition.snapshot import build_snapshot
from tech_scout_acquisition.worker import Worker


def plan():
    return {
        "from_year": 2016,
        "to_year": 2026,
        "risks": [],
        "directions": [
            {
                "domain_id": "battery",
                "name": "固态电池",
                "keywords": ["固态电池"],
                "excluded_keywords": [],
                "cpc_prefixes": [],
                "explanation": "检索",
            }
        ],
    }


def patent(key):
    return {
        "publication_number": key,
        "title": "固态电池",
        "abstract": "摘要",
        "publication_date": "2025-01-01",
        "current_assignees": ["Example Co Ltd"],
        "original_assignees": [],
        "list_assignees": ["示例有限公司"],
        "cpcs": ["H01M10/0562"],
        "domain_ids": ["battery"],
        "source_sha256": "a" * 64,
        "source_path": "browser/p.html",
        "source_url": f"https://patents.google.com/patent/{key}/zh",
    }


def company():
    return {
        "company_id": str(uuid4()),
        "name": "示例股份有限公司",
        "aliases": ["示例有限公司"],
        "english_name": "Example Co., Ltd.",
        "credit_code": "91110108MA007H3P5K",
        "fields": {},
        "source_sha256": "b" * 64,
        "source_path": "browser/c.html",
    }


def test_google_dynamic_result_and_detail_metadata_are_not_citations():
    rows = parse_results("""<search-result-item>
      <state-modifier data-result="patent/CN108550907B/zh">
      <a href="#">固态电池</a>
      </state-modifier>
      <h4 class="metadata">
      <span>
      <span class="bullet-before">
      <raw-html>发明人</raw-html>
      </span>
      </span>
      <span>
      <span class="bullet-before">
      <raw-html>示例有限公司</raw-html>
      </span>
      </span>
      </h4>
      </search-result-item>""")
    assert rows[0]["publication_number"] == "CN108550907B"
    assert rows[0]["list_assignees"] == ["示例有限公司"]
    p = parse_patent(
        """<meta name="citation_patent_number" content="CN:108550907:B">
      <meta name="DC.title" content="固态电池">
      <span itemprop="publicationNumber">US123A1</span>
      <section itemprop="abstract">摘要</section>
      <section itemprop="claims">权利要求</section>
      <dd itemprop="assigneeCurrent">Company A</dd>
      <dd itemprop="assigneeCurrent">University B</dd>
      <time itemprop="publicationDate">2020-08-21</time>""",
        "https://patents.google.com/patent/CN108550907B/zh",
    )
    assert p["publication_number"] == "CN108550907B"
    assert p["current_assignees"] == ["Company A", "University B"]
    assert p["grant_date"] is None


def test_cited_patent_applicants_are_not_current_patent_parties():
    p = parse_patent(
        '<meta name="citation_patent_number" content="CN:123:B">'
        '<meta name="DC.title" content="固态电池">'
        '<section itemprop="abstract">摘要</section>'
        '<dd itemprop="assigneeOriginal">Actual Applicant</dd>'
        '<dd itemprop="assigneeCurrent">Actual Owner</dd>'
        '<table><td itemprop="assigneeOriginal">Unrelated Citation Co</td></table>',
        "https://patents.google.com/patent/CN123B/zh",
    )
    assert p["original_assignees"] == ["Actual Applicant"]
    assert p["current_assignees"] == ["Actual Owner"]


def test_identity_normalization_does_not_strip_company_name_substrings():
    co = company()
    assert assignee_matches("Example Co Ltd", co)
    co["english_name"] = "Lincoln Limited"
    assert not assignee_matches("Lln Ltd", co)
    assert domestic_candidate("示例控股有限公司")
    assert not domestic_candidate("北京大学")


def test_listing_detail_disagreement_never_creates_ownership():
    p, co = patent("CN1B"), company()
    p["current_assignees"] = ["Different Auto R&D Co Ltd", "Some University"]
    s = build_snapshot(
        uuid4(), plan(), {"CN1B": p}, {"示例有限公司": {"companies": [co]}}
    )
    assert s["companies"]
    assert s["company-patent-relations"] == []
    assert all(not m["is_accepted"] for m in s["entity-matches"])
    assert len(s["patent-parties"]) == 3
    assert all(p["country"] is None for p in s["patent-parties"])


class MemoryStore:
    def __init__(self):
        self.job = {"plan": plan(), "status": "queued"}
        self.data = {}
        self.release = None

    async def get(self, _):
        return self.job

    async def items(self, _, kind):
        return copy.deepcopy(self.data.get(kind, {}))

    async def save(self, _, kind, key, data):
        self.data.setdefault(kind, {})[key] = copy.deepcopy(data)

    async def update(self, _, status, progress=None, error=None):
        self.job.update(status=status, error=error)

    async def checkpoint(self, _, progress):
        if self.job["status"] == "paused":
            raise AcquisitionBlocked("PAUSED", "暂停")
        self.job["status"] = "running"

    async def cached_company(self, *_):
        return None

    async def cache_company(self, *_):
        pass

    async def publish(self, _, snapshot):
        self.release = snapshot
        self.job["status"] = "completed"


@pytest.mark.asyncio
async def test_worker_resumes_100_publications_without_repeating_completed_details():
    store = MemoryStore()
    calls = []
    blocked = True

    class Browser:
        def __init__(self, _):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def search(self, url):
            from urllib.parse import parse_qs, urlparse

            page = int(parse_qs(urlparse(url).query)["page"][0])
            return [
                {"publication_number": f"CN{n:03}B", "list_assignees": []}
                for n in range(page * 10, (page + 1) * 10)
            ]

        async def patent(self, key):
            nonlocal blocked
            if key == "CN050B" and blocked:
                blocked = False
                raise AcquisitionBlocked("RATE_LIMITED", "稍后重试", 900)
            calls.append(key)
            p = patent(key)
            p["current_assignees"] = []
            return p

    worker = Worker(store, SimpleNamespace(acquisition_patent_limit=100), Browser)
    run_id = uuid4()
    await worker.execute(run_id)
    assert store.job["status"] == "waiting"
    assert len(store.data["patent"]) == 50
    assert store.release is None
    store.job["status"] = "queued"
    await worker.execute(run_id)
    assert store.job["status"] == "completed"
    assert len(store.release["patents"]) == 100
    assert len(calls) == len(set(calls)) == 100
    store.job["status"] = "queued"
    await worker.execute(run_id)
    assert len(calls) == 100


@pytest.mark.asyncio
async def test_paused_job_never_opens_browser():
    store = MemoryStore()
    store.job["status"] = "paused"

    def forbidden(_):
        raise AssertionError("browser should not start")

    await Worker(
        store, SimpleNamespace(acquisition_patent_limit=100), forbidden
    ).execute(uuid4())
    assert store.job["status"] == "paused"
    assert not store.data
