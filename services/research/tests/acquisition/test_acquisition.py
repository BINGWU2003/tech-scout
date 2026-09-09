import copy
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
    parse_patent,
    parse_results,
    search_url,
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


def google_patent_detail(
    publication="CN122716301A",
    title="固态电池极片生产方法",
    abstract="一种固态电池极片生产方法。",
):
    abstract_html = f'<div class="abstract">{abstract}</div>' if abstract else ""
    return f"""
      <meta name="citation_patent_number" content="{publication}">
      <meta name="DC.title" content="{title}">
      <meta name="DC.date" scheme="dateSubmitted" content="2025-03-06">
      <meta name="DC.date" scheme="issue" content="2026-09-08">
      <meta name="citation_patent_application_number"
        content="CN:2025102628579">
      <meta name="DC.contributor" scheme="inventor" content="张三">
      <meta name="DC.contributor" scheme="inventor" content="李四">
      {abstract_html}
      <patent-text name="description">说明书正文。</patent-text>
      <div class="claims">1. 一种固态电池。</div>
      <dl class="important-people">
        <dt>Inventor</dt><dd>张三</dd><dd>李四</dd>
        <dt>Current Assignee</dt><dd>示例科技股份有限公司</dd>
        <dd>日本电气硝子株式会社</dd>
      </dl>
      <dd itemprop="assigneeOriginal">原始示例有限公司</dd>
      <state-modifier data-cpc="H01M4/139"></state-modifier>
      <state-modifier data-cpc="H01M10/058"></state-modifier>
    """


def test_google_patents_detail_produces_a_cn_chinese_company_patent_record():
    url = "https://patents.google.com/patent/CN122716301A/zh"

    patent = parse_patent(google_patent_detail(), url)

    assert patent["publication_number"] == "CN122716301A"
    assert patent["title"] == "固态电池极片生产方法"
    assert patent["application_number"] == "CN2025102628579"
    assert patent["filing_date"] == "2025-03-06"
    assert patent["publication_date"] == "2026-09-08"
    assert patent["current_assignees"] == ["示例科技股份有限公司"]
    assert patent["original_assignees"] == ["原始示例有限公司"]
    assert patent["inventors"] == ["张三", "李四"]
    assert patent["cpcs"] == ["H01M4/139", "H01M10/058"]
    assert patent["abstract"] == "一种固态电池极片生产方法。"
    assert patent["claims"] == "1. 一种固态电池。"


def test_google_patents_results_keep_only_cn_chinese_titles_and_chinese_companies():
    def card(title, publication, applicant):
        return f"""<search-result-item><article>
          <state-modifier data-result="patent/{publication}/zh">
            <a href="#"><h3><raw-html>{title}</raw-html></h3></a>
          </state-modifier>
          <h4 class="metadata"><span><span class="bullet-before">
            <raw-html>张三</raw-html></span></span><span>
            <span class="bullet-before"><raw-html>{applicant}</raw-html></span>
          </span></h4>
          <h4 class="dates">Priority 2025-03-01 • Filed 2025-03-06 •
            Published 2026-09-08</h4>
        </article></search-result-item>"""

    html = "".join(
        [
            card("固态电池极片生产方法", "CN122716301A", "示例科技股份有限公司"),
            card("二次电池及其制造方法", "CN122720041A", "日本电气硝子株式会社"),
            card("ALL SOLID STATE BATTERY", "CN122719658A", "示例科技股份有限公司"),
            card("固态电池极片生产方法", "US122716301A", "示例科技股份有限公司"),
        ]
    )

    rows = parse_results(html, "https://patents.google.com/?q=固态电池")

    assert len(rows) == 1
    assert rows[0]["publication_number"] == "CN122716301A"
    assert rows[0]["list_assignees"] == ["示例科技股份有限公司"]
    assert rows[0]["list_title"] == "固态电池极片生产方法"
    assert rows[0]["publication_date"] == "2026-09-08"
    assert rows[0]["filing_date"] == "2025-03-06"
    assert rows[0]["detail_url"] == "https://patents.google.com/patent/CN122716301A/zh"


def test_google_patents_search_url_keeps_one_plain_chinese_keyword_and_cn_scope():
    direction = plan()["directions"][0]
    direction["excluded_keywords"] = ["液态电解质", "半固态"]
    direction["cpc_prefixes"] = [
        "H01M10/058",
        "H01M10/0525",
        "H01M4/00",
        "H01M10/04",
    ]
    url = search_url(direction, plan(), 0, "固态电池")
    query = parse_qs(urlparse(url).query)
    assert urlparse(url).hostname == "patents.google.com"
    assert query == {
        "q": ["固态电池"],
        "page": ["0"],
        "num": ["10"],
        "before": ["publication:20270101"],
        "after": ["publication:20160101"],
        "country": ["CN"],
        "language": ["CHINESE"],
        "dedup": ["family"],
    }


@pytest.mark.asyncio
async def test_browser_search_reads_google_patents_result_cards():
    result_html = """<search-result-item><article>
      <a data-result="patent/CN122716301A/zh"
        href="/patent/CN122716301A/zh">固态电池极片生产方法</a>
      <span itemprop="assignee">示例科技股份有限公司</span>
    </article></search-result-item>"""

    class Locator:
        async def evaluate_all(self, *_):
            return result_html

    class Page:
        def locator(self, selector):
            assert selector == "search-result-item"
            return Locator()

    browser = Browser.__new__(Browser)
    browser.page = Page()
    visits = []

    async def visit(url, selector):
        visits.append((url, selector))
        return True

    browser.visit = visit
    url = "https://patents.google.com/?q=固态电池&page=0&country=CN"

    rows = await browser.search(url)

    assert [row["publication_number"] for row in rows] == ["CN122716301A"]
    assert visits == [(url, "search-result-item")]


@pytest.mark.asyncio
async def test_browser_search_returns_empty_for_an_explicitly_empty_google_page():
    browser = Browser.__new__(Browser)

    async def visit(*_):
        return False

    browser.visit = visit
    assert await browser.search("https://patents.google.com/?q=不存在") == []


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
        "https://patents.google.com/patent/CN1A/zh",
        'meta[name="citation_patent_number"]',
    )
    assert browser.page.navigations == 3


def test_granted_patent_without_abstract_is_still_a_valid_record():
    patent = parse_patent(
        google_patent_detail("CN108550907B", abstract=""),
        "https://patents.google.com/patent/CN108550907B/zh",
    )
    assert patent["publication_number"] == "CN108550907B"
    assert patent["abstract"] is None
    assert patent["grant_date"] == "2026-09-08"


@pytest.mark.asyncio
async def test_patent_reads_google_patents_structured_detail():
    html = google_patent_detail()

    class DetailLocator:
        async def evaluate(self, script):
            required = (
                'meta[name="DC.date"]',
                'meta[name="citation_patent_application_number"]',
                "dl.important-people",
                'patent-text[name="description"]',
                "[data-cpc]",
                ".abstract",
                ".claims",
            )
            if all(selector in script for selector in required):
                return html
            return """
              <meta name="citation_patent_number" content="CN122716301A">
              <meta name="DC.title" content="固态电池极片生产方法">
            """

    class DetailPage:
        def locator(self, selector):
            assert selector == "html"
            return DetailLocator()

    browser = Browser.__new__(Browser)
    browser.page = DetailPage()

    visits = []

    async def visit(url, selector):
        visits.append((url, selector))
        return True

    browser.visit = visit
    listing = {"detail_url": "https://example.invalid/ignored"}
    patent = await browser.patent("CN122716301A", listing)
    assert patent["publication_number"] == "CN122716301A"
    assert patent["abstract"] == "一种固态电池极片生产方法。"
    assert patent["description"] == "说明书正文。"
    assert patent["claims"] == "1. 一种固态电池。"
    assert patent["current_assignees"] == ["示例科技股份有限公司"]
    assert patent["cpcs"] == ["H01M4/139", "H01M10/058"]
    assert visits == [
        (
            "https://patents.google.com/patent/CN122716301A/zh",
            "h1#title",
        )
    ]


@pytest.mark.asyncio
async def test_patent_retries_a_temporarily_incomplete_google_detail_dom():
    html = iter(
        [
            '<h1 id="title"></h1>',
            google_patent_detail(),
        ]
    )

    class DetailLocator:
        async def evaluate(self, _script):
            return next(html)

    class DetailPage:
        def locator(self, selector):
            assert selector == "html"
            return DetailLocator()

    browser = Browser.__new__(Browser)
    browser.page = DetailPage()
    visits = []

    async def visit(url, selector):
        visits.append((url, selector))
        return True

    browser.visit = visit

    patent = await browser.patent("CN122716301A", {})

    assert patent["publication_number"] == "CN122716301A"
    assert len(visits) == 2


@pytest.mark.asyncio
async def test_patent_accepts_google_publication_number_metadata_variant():
    html = google_patent_detail("CN113841279A").replace(
        'name="citation_patent_number" content="CN113841279A"',
        'name="citation_patent_publication_number" content="CN:113841279:A"',
    )

    class DetailLocator:
        async def evaluate(self, script):
            if 'meta[name="citation_patent_publication_number"]' in script:
                return html
            return '<meta name="DC.title" content="液体渗透固态电解质">'

    class DetailPage:
        def locator(self, selector):
            assert selector == "html"
            return DetailLocator()

    browser = Browser.__new__(Browser)
    browser.page = DetailPage()

    async def visit(*_):
        return True

    browser.visit = visit

    patent = await browser.patent("CN113841279A", {})

    assert patent["publication_number"] == "CN113841279A"


@pytest.mark.asyncio
async def test_company_uses_tianyancha_candidates_and_normalized_exact_identity():
    class Response:
        status = 200
        headers = {}

        async def json(self):
            return {
                "state": "ok",
                "data": {
                    "items": [
                        {
                            "id": 123,
                            "name": "<em>中科超能（深圳）新能源科技有限公司</em>",
                            "creditCode": "91440300MACUHG9Y8K",
                            "legalPersonName": "张三",
                            "regCapital": "1000万人民币",
                            "estiblishTime": "2023-08-17 00:00:00.0",
                            "regStatus": "存续",
                            "companyOrgType": "有限责任公司",
                            "regLocation": "深圳市南山区示例路1号",
                            "categoryStr": "科技推广和应用服务业",
                            "businessScope": "新材料技术研发",
                            "companyScale": "小型",
                            "historyNames": (
                                "深圳中科超能有限公司；中科超能科技有限公司"
                            ),
                            "englishName": "Example Energy Co., Ltd.",
                            "phone": "NEVER_PERSIST",
                            "emails": "NEVER_PERSIST@example.com",
                        },
                        {
                            "id": 456,
                            "name": "中科超能（深圳）新能源科技有限公司北京分公司",
                            "creditCode": "91110111MACYGLTL01",
                        },
                    ]
                },
            }

    class Request:
        async def get(self, *_args, **_kwargs):
            return Response()

    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.context = SimpleNamespace(request=Request())

    result = await browser.company("中科超能(深圳)新能源科技有限公司")

    assert result["status"] == "matched"
    assert len(result["companies"]) == 1
    record = result["companies"][0]
    assert record["name"] == "中科超能（深圳）新能源科技有限公司"
    assert record["credit_code"] == "91440300MACUHG9Y8K"
    assert record["aliases"] == [
        "深圳中科超能有限公司",
        "中科超能科技有限公司",
    ]
    assert record["english_name"] == "Example Energy Co., Ltd."
    assert record["fields"]["法定代表人"] == "张三"
    assert record["source_url"].startswith(
        "https://m.tianyancha.com/proxyPeers/getCompanyPhone.json?"
    )
    assert record["source_path"].endswith(".json")
    assert "NEVER_PERSIST" not in str(record)


@pytest.mark.asyncio
async def test_company_ignores_a_hong_kong_candidate_without_a_cn_credit_code():
    class Response:
        status = 200
        headers = {}

        async def json(self):
            return {
                "state": "ok",
                "data": {
                    "items": [
                        {
                            "id": 661017758,
                            "name": "<em>惠州亿纬锂能股份有限公司</em>",
                            "creditCode": "91441300734122111K",
                            "companyType": 1,
                            "base": "广东",
                        },
                        {
                            "id": 7866066178,
                            "name": "惠州億緯鋰能股份有限公司",
                            "creditCode": "78713229",
                            "companyType": 2,
                            "base": "香港",
                        },
                    ]
                },
            }

    class Request:
        async def get(self, *_args, **_kwargs):
            return Response()

    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.context = SimpleNamespace(request=Request())

    result = await browser.company("惠州亿纬锂能股份有限公司")

    assert result["status"] == "matched"
    assert [item["credit_code"] for item in result["companies"]] == [
        "91441300734122111K"
    ]


@pytest.mark.asyncio
async def test_company_treats_http_406_as_a_temporary_rate_limit():
    class Response:
        status = 406
        headers = {}

        async def json(self):
            raise AssertionError("a rate-limited response must not be parsed")

    class Request:
        async def get(self, *_args, **_kwargs):
            return Response()

    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.context = SimpleNamespace(request=Request())

    with pytest.raises(AcquisitionBlocked) as caught:
        await browser.company("比亚迪股份有限公司")

    assert (caught.value.code, caught.value.retry_after) == ("RATE_LIMITED", 900)


@pytest.mark.asyncio
async def test_company_treats_tianyancha_system_error_as_a_temporary_rate_limit():
    class Response:
        status = 200
        headers = {}

        async def json(self):
            return {"state": "error", "message": "系统异常"}

    class Request:
        async def get(self, *_args, **_kwargs):
            return Response()

    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.context = SimpleNamespace(request=Request())

    with pytest.raises(AcquisitionBlocked) as caught:
        await browser.company("伊奎希尔德医疗有限公司")

    assert (caught.value.code, caught.value.retry_after) == ("RATE_LIMITED", 900)


@pytest.mark.asyncio
async def test_company_treats_tianyancha_no_data_warning_as_not_found():
    class Response:
        status = 200
        headers = {}

        async def json(self):
            return {"state": "warn", "message": "无数据"}

    class Request:
        async def get(self, *_args, **_kwargs):
            return Response()

    browser = Browser.__new__(Browser)
    browser.config = SimpleNamespace(acquisition_interval_seconds=0)
    browser.last_request = time.monotonic() - 1
    browser.context = SimpleNamespace(request=Request())

    result = await browser.company("伊奎希尔德医疗有限公司")

    assert result == {"companies": [], "status": "not_found"}


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


def test_snapshot_preserves_the_company_provider_from_each_source():
    p = patent("CN2B")
    p["current_assignees"] = ["示例股份有限公司"]
    co = company()
    co["provider"] = "tianyancha"
    co["source_url"] = (
        "https://m.tianyancha.com/proxyPeers/getCompanyPhone.json?key=示例"
    )

    snapshot = build_snapshot(
        uuid4(), plan(), {"CN2B": p}, {"示例股份有限公司": {"companies": [co]}}
    )

    assert snapshot["companies"][0]["provider"] == "tianyancha"
    assert snapshot["entity-evidence"][0]["publisher"] == "tianyancha"


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
async def test_worker_searches_each_keyword_as_a_separate_google_query():
    store = MemoryStore()
    store.job["plan"]["directions"][0]["keywords"] = [
        "固态电池",
        "固态电解质",
    ]
    queries = []

    class Browser:
        def __init__(self, _):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def search(self, url):
            queries.append(parse_qs(urlparse(url).query)["q"][0])
            return []

    await Worker(
        store, SimpleNamespace(acquisition_patent_limit=100), Browser
    ).execute(uuid4())

    assert queries == ["固态电池", "固态电解质"]
    assert store.job["status"] == "completed"


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
                {
                    "publication_number": f"CN{n:03}B",
                    "list_assignees": [],
                    "detail_url": (
                        f"https://patents.google.com/patent/CN{n:03}B/zh"
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
    assert all(key.startswith("battery") for key in store.data["page"])
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
