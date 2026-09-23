import asyncio
from datetime import UTC, datetime, timedelta

from .models import AcquisitionBlocked
from .parsers import domestic_candidate, search_url
from .snapshot import build_snapshot
from .thread_browser import ThreadBrowser


class Worker:
    def __init__(self, store, config, browser_factory=ThreadBrowser):
        self.store = store
        self.config = config
        self.browser_factory = browser_factory
        self.closed = False
        self.active = None
        self.active_run = None

    async def sweep(self):
        # One browser owner across service processes, not merely one asyncio task.
        async with self.store.browser_lock() as acquired:
            if not acquired:
                raise RuntimeError("已有采集服务占用专用浏览器")
            await self.store.requeue_interrupted()
            while not self.closed:
                run_id = await self.store.next_pending()
                if run_id:
                    self.active_run = run_id
                    self.active = asyncio.create_task(self.guarded_execute(run_id))
                    await asyncio.gather(self.active, return_exceptions=True)
                    self.active = None
                    self.active_run = None
                await asyncio.sleep(1)

    async def checkpoint(self, run_id, stage, count, total, **summary):
        await self.store.checkpoint(
            run_id, {"stage": stage, "completed": count, "total": total, **summary}
        )

    async def guarded_execute(self, run_id):
        async with self.store.run_lock(run_id):
            job = await self.store.get(run_id)
            if job and job["status"] in {"queued", "running"}:
                await self.execute(run_id)

    async def execute(self, run_id):
        job = await self.store.get(run_id)
        plan = job["plan"]
        target = job.get("target")
        if target not in {"patents", "companies"}:
            raise AcquisitionBlocked("INVALID_TARGET", "采集任务阶段无效")
        active_search = {}
        try:
            await self.store.record(
                run_id,
                {
                    "stage": "companies" if target == "companies" else "search",
                    "message": "开始执行；已完成的采集项将从断点继续。",
                    "outcome": "running",
                },
            )
            await self.checkpoint(
                run_id,
                "companies" if target == "companies" else "search",
                0,
                None,
            )
            async with self.browser_factory(self.config) as browser:
                discovered = await self.store.items(run_id, "discovered")
                pages = await self.store.items(run_id, "page")
                failures = await self.store.items(run_id, "failure")
                searches = []
                for direction in plan["directions"]:
                    keywords = list(dict.fromkeys(direction["keywords"])) or [
                        direction["name"]
                    ]
                    for index, keyword in enumerate(keywords):
                        cursor = (
                            direction["domain_id"]
                            if len(keywords) == 1
                            else f"{direction['domain_id']}:{index}"
                        )
                        searches.append((cursor, direction, keyword))
                ended = {
                    key.removeprefix("search:")
                    for key in failures
                    if key.startswith("search:")
                }
                page_limit = plan["pages_per_keyword"]
                for page in range(0 if target == "companies" else page_limit):
                    for cursor, direction, keyword in searches:
                        if cursor in ended:
                            continue
                        page_key = f"{cursor}:{page}"
                        if page_key in pages:
                            if pages[page_key].get("end"):
                                ended.add(cursor)
                            continue
                        await self.checkpoint(
                            run_id,
                            "search",
                            len(discovered),
                            None,
                        )
                        active_search = {
                            "stage": "search",
                            "direction": direction["name"],
                            "domainId": direction["domain_id"],
                            "keyword": keyword,
                            "page": page + 1,
                            "url": search_url(direction, plan, page, keyword),
                        }
                        await self.store.record(
                            run_id,
                            {
                                **active_search,
                                "message": "正在搜索 Google Patents",
                                "outcome": "running",
                            },
                        )
                        try:
                            result = await browser.search(active_search["url"])
                        except AcquisitionBlocked as exc:
                            if exc.code not in {
                                "NETWORK_ERROR",
                                "INVALID_QUERY",
                                "PARSE_CHANGED",
                            }:
                                raise
                            failure = {
                                **active_search,
                                "outcome": "failed",
                                "finishReason": "failed",
                                "message": exc.message,
                            }
                            await self.store.save(
                                run_id, "failure", f"search:{cursor}", failure
                            )
                            failures[f"search:{cursor}"] = failure
                            await self.store.record(run_id, failure)
                            ended.add(cursor)
                            active_search = {}
                            continue
                        rows = result["records"]
                        eligible = []
                        for row in rows:
                            date = row.get("publication_date") or ""
                            year = int(date[:4]) if date[:4].isdigit() else None
                            if year is not None and not (
                                plan["from_year"] <= year <= plan["to_year"]
                            ):
                                continue
                            eligible.append(row)
                        for row in eligible:
                            key = row["publication_number"]
                            existing = discovered.get(key, {**row, "domain_ids": []})
                            if direction["domain_id"] not in existing["domain_ids"]:
                                existing["domain_ids"].append(direction["domain_id"])
                            discovered[key] = existing
                            await self.store.save(run_id, "discovered", key, existing)
                        ids = result["raw_ids"]
                        previous = pages.get(f"{cursor}:{page - 1}", {})
                        reason = (
                            "no_results"
                            if not ids
                            else "repeated_page"
                            if ids == previous.get("ids")
                            else "page_limit"
                            if page + 1 == page_limit
                            else None
                        )
                        end = reason is not None
                        pages[page_key] = {
                            "end": end,
                            "ids": ids,
                            "finishReason": reason,
                        }
                        await self.store.save(run_id, "page", page_key, pages[page_key])
                        await self.store.record(
                            run_id,
                            {
                                **active_search,
                                "message": "本页检索完成",
                                "outcome": "completed",
                                "count": len(rows),
                                **({"finishReason": reason} if reason else {}),
                                "completed": len(discovered),
                            },
                        )
                        active_search = {}
                        if end:
                            ended.add(cursor)
                    if len(ended) == len(searches):
                        break
                patents = await self.store.items(run_id, "patent")
                for key, listing in [] if target == "companies" else discovered.items():
                    await self.checkpoint(
                        run_id, "patents", len(patents), len(discovered)
                    )
                    if key not in patents and f"patent:{key}" not in failures:
                        active_search = {"stage": "patents", "publicationNumber": key}
                        try:
                            record = await browser.patent(key, listing)
                            if record["publication_number"] != key:
                                raise AcquisitionBlocked(
                                    "PARSE_CHANGED", "详情公开号与检索记录不一致"
                                )
                        except AcquisitionBlocked as exc:
                            if exc.code not in {"NETWORK_ERROR", "PARSE_CHANGED"}:
                                raise
                            failure = {
                                **active_search,
                                "outcome": "failed",
                                "finishReason": "failed",
                                "message": exc.message,
                            }
                            await self.store.save(
                                run_id, "failure", f"patent:{key}", failure
                            )
                            failures[f"patent:{key}"] = failure
                            await self.store.record(run_id, failure)
                            active_search = {}
                            continue
                        record.update(
                            list_assignees=listing["list_assignees"],
                            list_source=listing.get("list_source"),
                            domain_ids=listing["domain_ids"],
                        )
                        await self.store.save(run_id, "patent", key, record)
                        patents[key] = record
                        active_search = {}
                if target == "patents":
                    await self.checkpoint(
                        run_id,
                        "patents",
                        len(patents),
                        len(discovered),
                        searchFailed=sum(key.startswith("search:") for key in failures),
                        detailFailed=sum(key.startswith("patent:") for key in failures),
                    )
                    await self.store.record(
                        run_id,
                        {
                            "stage": "patents",
                            "message": "专利采集部分完成，请查看失败项。"
                            if failures
                            else "专利采集完成。",
                            "outcome": "completed",
                            "completed": len(patents),
                        },
                    )
                    await self.store.complete_patents(run_id)
                    return
                targets = job.get("company_targets") or []
                names = {
                    target["query_key"]: target["name"]
                    for target in targets
                    if domestic_candidate(target["name"])
                }
                companies = await self.store.items(run_id, "company")
                for key, name in names.items():
                    await self.checkpoint(
                        run_id, "companies", len(companies), len(names)
                    )
                    if key in companies:
                        continue
                    await self.store.record(
                        run_id,
                        {
                            "stage": "companies",
                            "direction": name,
                            "message": "正在查询企业登记信息",
                            "outcome": "running",
                        },
                    )
                    record = await self.store.cached_company(
                        key, self.config.acquisition_company_cache_days
                    )
                    if record is None:
                        record = await browser.company(name)
                        await self.store.cache_company(key, record)
                    await self.store.save(run_id, "company", key, record)
                    companies[key] = record
                    await self.store.record(
                        run_id,
                        {
                            "stage": "companies",
                            "direction": name,
                            "message": "企业信息查询完成"
                            if record["status"] == "found"
                            else "未找到可匹配的企业登记信息",
                            "outcome": "completed",
                            "completed": len(companies),
                        },
                    )
                await self.checkpoint(run_id, "snapshot", len(patents), len(discovered))
                await self.store.publish(
                    run_id, build_snapshot(run_id, plan, patents, companies)
                )
        except AcquisitionBlocked as exc:
            await self.store.record(
                run_id,
                {
                    "stage": "acquisition",
                    **active_search,
                    "message": exc.message,
                    "outcome": "failed",
                },
            )
            status = (
                "paused"
                if exc.code
                in {"PAUSED", "CAPTCHA_REQUIRED", "ACCESS_REQUIRED", "RATE_LIMITED"}
                else "waiting"
            )
            error = {"code": exc.code, "message": exc.message}
            if exc.retry_after:
                error["retry_at"] = (
                    datetime.now(UTC) + timedelta(seconds=exc.retry_after)
                ).isoformat()
            await self.store.update(run_id, status, error=error)
        except asyncio.CancelledError:
            await self.store.record(
                run_id,
                {
                    "stage": "acquisition",
                    **active_search,
                    "message": "采集已停止，完成项已保留",
                    "outcome": "stopped",
                },
            )
            await self.store.update(
                run_id,
                "paused",
                error={"code": "WORKER_INTERRUPTED", "message": "采集进程中断，可继续"},
            )
            raise
        except Exception:
            await self.store.record(
                run_id,
                {
                    "stage": "acquisition",
                    **active_search,
                    "message": "采集失败，可从已完成项重试",
                    "outcome": "failed",
                },
            )
            await self.store.update(
                run_id,
                "failed",
                error={
                    "code": "ACQUISITION_FAILED",
                    "message": "采集失败，已保留完成项，可重试",
                },
            )
