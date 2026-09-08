import asyncio
import json
import time
from contextlib import suppress
from urllib.parse import quote, urljoin, urlparse

from playwright.async_api import async_playwright

from .models import AcquisitionBlocked
from .parsers import identity_match, parse_company, parse_patent, parse_results


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
            await self.context.add_init_script(
                "if (location.origin === 'https://riskbird.com') {"
                "const saved = " + json.dumps(session.get("sessionStorage", {})) + ";"
                "for (const [key,value] of Object.entries(saved)) "
                "sessionStorage.setItem(key,value); }"
            )
        self.page = await self.context.new_page()
        return self

    async def __aexit__(self, *args):
        with suppress(Exception):
            await self.preserve_session()
        await self.context.close()
        await self.playwright.stop()

    async def preserve_session(self):
        # Private login material stays under the dedicated user profile, never in DB.
        session = {"cookies": await self.context.cookies()}
        if self.session_file.exists():
            session["sessionStorage"] = json.loads(
                self.session_file.read_text(encoding="utf-8")
            ).get("sessionStorage", {})
        for page in self.context.pages:
            if urlparse(page.url).hostname == "riskbird.com":
                session["sessionStorage"] = await page.evaluate(
                    "Object.fromEntries(Object.entries(sessionStorage))"
                )
        temporary = self.session_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(session), encoding="utf-8")
        temporary.replace(self.session_file)

    async def visit(self, url, selector):
        if urlparse(url).hostname not in {
            "patents.google.com",
            "riskbird.com",
            "www.riskbird.com",
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
                        s in text
                        for s in ("验证码", "人机验证", "unusual traffic", "captcha")
                    ):
                        raise AcquisitionBlocked(
                            "CAPTCHA_REQUIRED", "请在专用浏览器完成人工验证后继续"
                        ) from None
                    dialogs = " ".join(
                        await self.page.locator(
                            '[role="dialog"]:visible'
                        ).all_text_contents()
                    )
                    login_button = self.page.get_by_role("button", name="登录试试")
                    if "riskbird" in url and (
                        "登录" in dialogs or await login_button.is_visible()
                    ):
                        raise AcquisitionBlocked(
                            "LOGIN_REQUIRED",
                            "请先运行 acquisition login 完成风鸟登录，再继续任务",
                        ) from None
                    if any(
                        message in text
                        for message in (
                            "没有找到",
                            "未找到相关企业",
                            "No results",
                            "did not match any documents",
                            "0 条",
                        )
                    ):
                        return False
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
        rows = parse_results(html, url)
        if not rows:
            raise AcquisitionBlocked("PARSE_CHANGED", "检索页存在结果但无法解析公开号")
        return rows

    async def patent(self, publication):
        url = "https://patents.google.com/patent/" + publication + "/zh"
        await self.visit(url, '[itemprop="abstract"], #abstract, .abstract')
        # Patent pages are public. Remove navigation/scripts before preservation.
        html = await self.page.locator("html").evaluate("""el => {
            const selectors = 'meta[name="DC.title"],'
                + 'meta[name="citation_patent_number"],'
                + 'meta[itemprop],dd[itemprop],h1#title,[itemprop="abstract"],'
                + '[itemprop="description"],[itemprop="claims"],'
                + 'dd[itemprop="assigneeCurrent"],dd[itemprop="assigneeOriginal"],'
                + 'dd[itemprop="inventor"],[itemprop="Code"],time[itemprop]';
            return [...el.querySelectorAll(selectors)].map(e=>e.outerHTML).join('\\n');
        }""")
        return parse_patent(html, url)

    async def company(self, name):
        url = "https://riskbird.com/search/company?keyword=" + quote(name)
        if not await self.visit(url, 'a[href*="/ent/"]'):
            return {"companies": [], "status": "not_found"}
        links = await self.page.locator('a[href*="/ent/"]').evaluate_all(
            "els => els.map(e => ({name:e.innerText.trim(),url:e.href}))"
        )
        links = list(
            {
                r["url"].split("?")[0]: r
                for r in links
                if r["name"] not in {"更多", ""}
            }.values()
        )
        # Examine a bounded candidate set; never treat the first result as an identity.
        exact = [r for r in links if r["name"] == name]
        chosen = exact or links[:3]
        companies = []
        for link in chosen[:3]:
            target = urljoin(url, link["url"])
            await self.visit(target, 'table:has-text("统一社会信用代码")')
            html = await self.page.locator("table").evaluate_all(
                "els => els.map(e => e.outerHTML).join('\\n')"
            )
            company = parse_company(html, target)
            if identity_match(name, company):
                companies.append(company)
        return {
            "companies": companies,
            "status": "matched" if len(companies) == 1 else "unresolved",
        }
