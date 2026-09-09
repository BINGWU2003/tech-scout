import asyncio
import json
import re
import time
from contextlib import suppress
from urllib.parse import urlencode, urlparse

from playwright.async_api import async_playwright

from .models import AcquisitionBlocked
from .parsers import (
    identity_match,
    parse_company_item,
    parse_patent,
    parse_results,
)


def _explicitly_empty(text):
    folded = text.casefold()
    return any(
        message in folded
        for message in (
            "没有找到",
            "未找到相关企业",
            "no results",
            "did not match any documents",
            "暂未检索到相关结果",
        )
    ) or bool(
        re.search(r"(?<!\d)0\s*条(?:文献|结果)?", text)
        or re.search(r"\b1\s*/\s*0\b", text)
    )


class Browser:
    def __init__(self, config):
        self.config = config
        self.last_request = 0
        self.profile = config.acquisition_profile_dir.expanduser().resolve()
        self.session_file = self.profile / "tech-scout-session.json"

    async def __aenter__(self):
        self.playwright = await async_playwright().start()
        try:
            self.context = await self.playwright.chromium.launch_persistent_context(
                str(self.profile),
                channel=self.config.acquisition_browser_channel,
                headless=False,
            )
        except Exception:
            await self.playwright.stop()
            raise AcquisitionBlocked(
                "BROWSER_UNAVAILABLE", "无法启动专用浏览器，请关闭占用该配置的登录窗口"
            ) from None
        if self.session_file.exists():
            session = json.loads(self.session_file.read_text(encoding="utf-8"))
            await self.context.add_cookies(session.get("cookies", []))
        self.page = await self.context.new_page()
        return self

    async def __aexit__(self, *args):
        with suppress(Exception):
            await self.preserve_session()
        await self.context.close()
        await self.playwright.stop()

    async def preserve_session(self):
        # Browser cookies stay under the dedicated user profile, never in the DB.
        session = {"cookies": await self.context.cookies()}
        temporary = self.session_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(session), encoding="utf-8")
        temporary.replace(self.session_file)

    async def visit(self, url, selector):
        if urlparse(url).hostname not in {
            "patents.google.com",
        }:
            raise AcquisitionBlocked("UNEXPECTED_URL", "来源链接不属于已配置的数据源")
        for attempt in range(3):
            await asyncio.sleep(
                max(
                    0,
                    self.config.acquisition_interval_seconds
                    - (time.monotonic() - self.last_request),
                )
            )
            self.last_request = time.monotonic()
            try:
                response = await self.page.goto(
                    url, wait_until="domcontentloaded", timeout=45000
                )
                if response and response.status == 429:
                    after = response.headers.get("retry-after", "900")
                    raise AcquisitionBlocked(
                        "RATE_LIMITED",
                        "来源限流，稍后继续",
                        int(after) if after.isdigit() else 900,
                    )
                if response and response.status == 202:
                    raise AcquisitionBlocked(
                        "ACCESS_REQUIRED",
                        "Google Patents 要求来源校验，请在专用浏览器检查页面",
                    )
                if response and response.status >= 500:
                    raise RuntimeError("upstream unavailable")
                if response and response.status in {401, 403}:
                    raise AcquisitionBlocked(
                        "ACCESS_REQUIRED", "来源拒绝访问，请在专用浏览器检查账号权限"
                    )
                try:
                    await self.page.locator(selector).first.wait_for(timeout=30000)
                except Exception:
                    text = await self.page.locator("body").inner_text()
                    if any(
                        message in text.casefold()
                        for message in (
                            "query syntax error",
                            "检索表达式错误",
                            "语法错误",
                        )
                    ):
                        raise AcquisitionBlocked(
                            "INVALID_QUERY",
                            "Google Patents 拒绝检索条件，请检查关键词",
                        ) from None
                    if any(
                        s in text
                        for s in ("验证码", "人机验证", "unusual traffic", "captcha")
                    ):
                        raise AcquisitionBlocked(
                            "CAPTCHA_REQUIRED", "请在专用浏览器完成人工验证后继续"
                        ) from None
                    if _explicitly_empty(text):
                        return False
                    if attempt < 2:
                        # A successful navigation can still leave the dynamic
                        # document body incomplete. Retry the whole navigation
                        # before concluding that the source structure changed.
                        continue
                    raise AcquisitionBlocked(
                        "PARSE_CHANGED",
                        "目标内容未加载，已暂停以避免把空页面当作无结果",
                    ) from None
                return True
            except AcquisitionBlocked:
                raise
            except Exception:
                if attempt == 2:
                    raise AcquisitionBlocked(
                        "NETWORK_ERROR", "页面加载失败三次，可重试继续"
                    ) from None
        return False

    async def search(self, url):
        if not await self.visit(url, "search-result-item"):
            return []
        html = await self.page.locator("search-result-item").evaluate_all(
            "els => els.map(e => e.outerHTML).join('\\n')"
        )
        return parse_results(html, url)

    async def patent(self, publication, _listing):
        url = f"https://patents.google.com/patent/{publication}/zh"
        for attempt in range(3):
            if not await self.visit(url, "h1#title"):
                raise AcquisitionBlocked(
                    "PARSE_CHANGED", "Google Patents 专利详情不存在"
                )
            html = await self.page.locator("html").evaluate("""el => {
                const selectors = 'meta[name="DC.title"],'
                    + 'meta[name="citation_patent_number"],'
                    + 'meta[name="citation_patent_publication_number"],'
                    + 'meta[name="DC.date"],meta[name="DC.description"],'
                    + 'meta[name="citation_patent_application_number"],'
                    + 'meta[name="DC.contributor"],meta[itemprop],dd[itemprop],'
                    + 'h1#title,[itemprop="abstract"],.abstract,'
                    + '[itemprop="description"],patent-text[name="description"],'
                    + '[itemprop="claims"],.claims,dl.important-people,[data-cpc],'
                    + 'dd[itemprop="assigneeCurrent"],'
                    + 'dd[itemprop="assigneeOriginal"],dd[itemprop="inventor"],'
                    + '[itemprop="Code"],time[itemprop]';
                return [...el.querySelectorAll(selectors)]
                    .map(e => e.outerHTML).join('\\n');
            }""")
            try:
                patent = parse_patent(html, url)
            except AcquisitionBlocked as exc:
                if exc.code == "PARSE_CHANGED" and attempt < 2:
                    continue
                raise
            if patent["publication_number"] != publication:
                raise AcquisitionBlocked(
                    "PARSE_CHANGED", "详情公开号与检索记录不一致"
                )
            return patent
        raise AcquisitionBlocked("PARSE_CHANGED", "Google Patents 专利详情解析失败")

    async def company(self, name):
        endpoint = "https://m.tianyancha.com/proxyPeers/getCompanyPhone.json"
        params = {"cate": "", "baseCode": "", "base": "", "key": name}
        url = endpoint + "?" + urlencode(params)
        await asyncio.sleep(
            max(
                0,
                self.config.acquisition_interval_seconds
                - (time.monotonic() - self.last_request),
            )
        )
        self.last_request = time.monotonic()
        try:
            response = await self.context.request.get(
                endpoint,
                params=params,
                headers={"Accept": "application/json"},
                timeout=45000,
            )
        except Exception:
            raise AcquisitionBlocked(
                "NETWORK_ERROR", "企业查询接口访问失败，可重试继续"
            ) from None
        if response.status in {406, 429}:
            after = response.headers.get("retry-after", "900")
            raise AcquisitionBlocked(
                "RATE_LIMITED",
                "企业查询接口限流，稍后继续",
                int(after) if after.isdigit() else 900,
            )
        if response.status in {401, 403}:
            raise AcquisitionBlocked("ACCESS_REQUIRED", "企业查询接口拒绝访问")
        if response.status >= 500:
            raise AcquisitionBlocked("NETWORK_ERROR", "企业查询接口暂时不可用")
        try:
            payload = await response.json()
        except Exception:
            raise AcquisitionBlocked(
                "PARSE_CHANGED", "企业查询接口没有返回有效数据"
            ) from None
        if payload.get("state") == "error" and payload.get("message") == "系统异常":
            raise AcquisitionBlocked(
                "RATE_LIMITED", "企业查询接口限流，稍后继续", 900
            )
        if payload.get("state") == "warn" and payload.get("message") == "无数据":
            return {"companies": [], "status": "not_found"}
        if payload.get("state") != "ok":
            raise AcquisitionBlocked("PARSE_CHANGED", "企业查询接口返回状态异常")
        items = payload.get("data", {}).get("items", [])
        if not isinstance(items, list):
            raise AcquisitionBlocked("PARSE_CHANGED", "企业查询结果结构已变化")
        companies = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                company = parse_company_item(item, url)
            except AcquisitionBlocked as exc:
                if exc.code == "UNSUPPORTED_COMPANY":
                    continue
                raise
            if identity_match(name, company):
                companies.append(company)
        companies = list(
            {company["credit_code"]: company for company in companies}.values()
        )
        return {
            "companies": companies,
            "status": "matched"
            if len(companies) == 1
            else "not_found"
            if not items
            else "unresolved",
        }
