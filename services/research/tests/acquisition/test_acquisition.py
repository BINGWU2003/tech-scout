import copy
import json
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest

from tech_scout_acquisition.browser import Browser
from tech_scout_acquisition.models import AcquisitionBlocked
from tech_scout_acquisition.parsers import (
    assignee_matches,
    domestic_candidate,
    parse_company,
    parse_patent,
    parse_results,
    search_url,
    select_patent_html,
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
        "source_url": f"https://d.wanfangdata.com.cn/patent/{key}",
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


def wanfang_detail(publication="CN122291669A", abstract="摘要内容"):
    return f"""<html><nav>private navigation</nav><script>secret()</script>
      <div id="essential">
        <div class="detailTitleCN"><div><span>复合固态电解质</span></div></div>
        <div class="detailList">
          <div class="summary list"><span class="item">摘要：</span>
            <span class="text-overflow">{abstract}</span></div>
          <div class="patentCode list"><span class="item">申请/专利号：</span>
            <div class="itemUrl">CN202610246657.9</div></div>
          <div class="applicationDate list"><span class="item">申请日期：</span>
            <div class="itemUrl">2026-03-02</div></div>
          <div class="publicationNo list"><span class="item">公开/公告号：</span>
            <div class="itemUrl">{publication}</div></div>
          <div class="applicationDate list"><span class="item">公开/公告日：</span>
            <div class="itemUrl">2026-06-26</div></div>
          <div class="classify list"><span class="item">分类号：</span>
            <div class="itemUrl"><span class="patentCode">
              <span>H01M10/0565</span></span>
              <span class="patentCode"><span>H01M10/058</span></span></div></div>
          <div class="applicant list"><span class="item">申请/专利权人：</span>
            <div class="itemUrl"><a><span>示例有限公司</span></a></div></div>
          <div class="applicant list"><span class="item">发明/设计人：</span>
            <div class="itemUrl"><a><span>张三</span></a>
              <a><span>李四</span></a></div></div>
          <div class="signoryItem list"><span class="item">主权项：</span>
            <div class="itemUrl">1. 一种固态电池。</div></div>
        </div>
      </div></html>"""


def test_wanfang_dynamic_result_and_detail_fields():
    rows = parse_results("""<div class="normal-list">
      <div class="title-area"><span class="title">固态<span>电池</span></span>
        <span class="title-id-hidden">
          patent_ZL_CN202610246657.9_CN108550907B_20260626
        </span></div>
      <div class="author-area"><span class="t-ML6">发明专利</span>
        <span class="t-ML6">CN108550907B</span>
        <span class="authors">示例有限公司</span>
        <span class="applyDate">申请日：2026-03-02 公开日：2026-06-26</span>
      </div>
      <div class="abstract-area"><span>摘要：</span><span>摘要内容</span></div>
    </div>""", "https://s.wanfangdata.com.cn/patent?q=test")
    assert rows[0]["publication_number"] == "CN108550907B"
    assert rows[0]["list_assignees"] == ["示例有限公司"]
    assert rows[0]["list_title"] == "固态 电池"
    assert rows[0]["publication_date"] == "2026-06-26"
    assert rows[0]["detail_url"].endswith(
        "/ZL_CN202610246657.9_CN108550907B_20260626"
    )
    p = parse_patent(wanfang_detail(), rows[0]["detail_url"])
    assert p["publication_number"] == "CN122291669A"
    assert p["current_assignees"] == ["示例有限公司"]
    assert p["inventors"] == ["张三", "李四"]
    assert p["cpcs"] == ["H01M10/0565", "H01M10/058"]
    assert p["claims"] == "1. 一种固态电池。"


def test_search_url_uses_wanfang_ipc_years_without_sending_exclusion_terms():
    direction = plan()["directions"][0]
    direction["excluded_keywords"] = ["液态电解质", "半固态"]
    direction["cpc_prefixes"] = [
        "H01M10/058",
        "H01M10/0525",
        "H01M4/00",
        "H01M10/04",
    ]
    query = parse_qs(urlparse(search_url(direction, plan(), 0)).query)
    assert urlparse(search_url(direction, plan(), 0)).hostname == (
        "s.wanfangdata.com.cn"
    )
    assert query["p"] == ["1"]
    assert query["s"] == ["20"]
    assert "分类号:" in query["q"][0]
    assert "H01M10/058" in query["q"][0]
    assert "液态电解质" not in query["q"][0]
    assert "半固态" not in query["q"][0]
    facet = json.loads(query["facet"][0])
    assert facet[0]["PublishYear"]["value"] == [
        str(year) for year in range(2016, 2027)
    ]


class EmptySearchLocator:
    def __init__(self, count=0, text=""):
        self.result_count = count
        self.text = text

    async def count(self):
        return self.result_count

    async def inner_text(self):
        return self.text


class EmptySearchPage:
    def __init__(self, body=""):
        self.body = body

    def locator(self, selector):
        if selector == "body":
            return EmptySearchLocator(text=self.body)
        return EmptySearchLocator()


class RetryVisitLocator:
    def __init__(self, page, selector):
        self.page = page
        self.selector = selector

    @property
    def first(self):
        return self

    async def wait_for(self, **_):
        self.page.waits += 1
        if self.page.waits < 3:
            raise RuntimeError("dynamic content is still loading")

    async def inner_text(self):
        return "Patents"

    async def all_text_contents(self):
        return []

    async def is_visible(self):
        return False


class RetryVisitPage:
    def __init__(self):
        self.navigations = 0
        self.waits = 0

    async def goto(self, *_args, **_kwargs):
        self.navigations += 1
        return SimpleNamespace(status=200, headers={})

    def locator(self, selector):
        return RetryVisitLocator(self, selector)

    def get_by_role(self, *_args, **_kwargs):
        return RetryVisitLocator(self, "login")


@pytest.mark.asyncio
async def test_visit_retries_incomplete_dynamic_content_before_parse_error():
    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.page = RetryVisitPage()
    assert await browser.visit(
        "https://d.wanfangdata.com.cn/patent/ZL_CN1_CN1A_20260101", "#essential"
    )
    assert browser.page.navigations == 3


@pytest.mark.asyncio
async def test_loaded_empty_later_search_page_is_the_end_of_results():
    browser = Browser.__new__(Browser)
    browser.page = EmptySearchPage("第 3 页")
    selectors = []

    async def visit(_, selector):
        selectors.append(selector)
        return True

    browser.visit = visit
    assert await browser.search("https://s.wanfangdata.com.cn/patent?q=test&p=3") == []
    assert selectors == [".normal-list"]


@pytest.mark.asyncio
async def test_loaded_first_search_page_without_cards_remains_a_parser_error():
    browser = Browser.__new__(Browser)
    browser.page = EmptySearchPage("专利")

    async def visit(*_):
        return True

    browser.visit = visit
    with pytest.raises(AcquisitionBlocked, match="无法解析结果卡片") as error:
        await browser.search("https://s.wanfangdata.com.cn/patent?q=test&p=1")
    assert error.value.code == "PARSE_CHANGED"


@pytest.mark.asyncio
async def test_wanfang_query_syntax_error_is_not_treated_as_no_results():
    browser = Browser.__new__(Browser)
    browser.page = EmptySearchPage(
        "未找到结果，检索表达式错误"
    )

    async def visit(*_):
        return True

    browser.visit = visit
    with pytest.raises(AcquisitionBlocked, match="拒绝检索条件") as error:
        await browser.search("https://s.wanfangdata.com.cn/patent?q=test&p=1")
    assert error.value.code == "INVALID_QUERY"


def test_granted_patent_without_abstract_is_still_a_valid_record():
    patent = parse_patent(
        wanfang_detail("CN108550907B", ""),
        "https://d.wanfangdata.com.cn/patent/ZL_CN1_CN108550907B_20260626",
    )
    assert patent["publication_number"] == "CN108550907B"
    assert patent["abstract"] is None
    assert patent["grant_date"] == "2026-06-26"


def test_wanfang_primary_publication_ignores_related_publication_in_same_field():
    patent = parse_patent(
        wanfang_detail(
            "CN115763727B（同族公开/公告号：CN115763727A）",
        ),
        "https://d.wanfangdata.com.cn/patent/"
        "ZL_CN202211371051.6_CN115763727B_20260127",
    )
    assert patent["publication_number"] == "CN115763727B"
    assert patent["grant_date"] == "2026-06-26"


@pytest.mark.asyncio
async def test_patent_reads_rendered_wanfang_detail_and_discards_navigation():
    html = wanfang_detail()

    class DetailLocator:
        async def evaluate(self, *_):
            return html

    class DetailPage:
        def locator(self, selector):
            assert selector == "#essential"
            return DetailLocator()

    browser = Browser.__new__(Browser)
    browser.page = DetailPage()

    async def visit(*_):
        return True

    browser.visit = visit
    listing = {
        "detail_url": "https://d.wanfangdata.com.cn/patent/"
        "ZL_CN202610246657.9_CN122291669A_20260626"
    }
    patent = await browser.patent("CN122291669A", listing)
    assert patent["publication_number"] == "CN122291669A"
    assert "private navigation" not in patent["content"]
    assert "secret()" not in patent["content"]
    assert select_patent_html(html) == patent["content"]


@pytest.mark.asyncio
async def test_foreign_company_without_cn_credit_code_remains_unresolved():
    class CompanyLocator:
        def __init__(self, selector):
            self.selector = selector

        async def evaluate_all(self, *_):
            if self.selector.startswith("a["):
                return [
                    {
                        "name": "阿里巴巴新加坡控股有限公司",
                        "url": "https://riskbird.com/ent/foreign",
                    }
                ]
            return """<table><tr><th>企业名称</th>
              <td>阿里巴巴新加坡控股有限公司</td></tr>
              <tr><th>统一社会信用代码</th><td>-</td></tr></table>"""

    class CompanyPage:
        def locator(self, selector):
            return CompanyLocator(selector)

    browser = Browser.__new__(Browser)
    browser.page = CompanyPage()

    async def visit(*_):
        return True

    browser.visit = visit
    result = await browser.company("阿里巴巴新加坡控股有限公司")
    assert result == {"companies": [], "status": "unresolved"}
    with pytest.raises(AcquisitionBlocked) as error:
        parse_company(
            """<table><tr><th>企业名称</th><td>境外主体有限公司</td></tr>
            <tr><th>统一社会信用代码</th><td>-</td></tr></table>""",
            "https://riskbird.com/ent/foreign",
        )
    assert error.value.code == "UNSUPPORTED_COMPANY"


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

            page = int(parse_qs(urlparse(url).query)["p"][0]) - 1
            return [
                {
                    "publication_number": f"CN{n:03}B",
                    "list_assignees": [],
                    "detail_url": (
                        "https://d.wanfangdata.com.cn/patent/"
                        f"ZL_CN{n:03}_CN{n:03}B_20250101"
                    ),
                }
                for n in range(page * 10, (page + 1) * 10)
            ]

        async def patent(self, key, _listing):
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
    assert "battery:0" in store.data["page"]
    assert all(not key.startswith("wanfang-") for key in store.data["page"])
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
