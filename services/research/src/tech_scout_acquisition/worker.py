import asyncio
from datetime import UTC, datetime, timedelta

from .models import AcquisitionBlocked
from .parsers import domestic_candidate, normalized, search_url
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
        async with self.store.pool.connection() as guard:
            cur = await guard.execute(
                "SELECT pg_try_advisory_lock(720260907) AS acquired"
            )
            if not (await cur.fetchone())["acquired"]:
                raise RuntimeError("已有采集服务占用专用浏览器")
            try:
                await guard.execute(
                    "UPDATE ingestion.job SET status='queued' WHERE status='running'"
                )
                while not self.closed:
                    cur = await guard.execute(
                        "SELECT run_id FROM ingestion.job WHERE status='queued' "
                        "ORDER BY created_at LIMIT 1"
                    )
                    row = await cur.fetchone()
                    if row:
                        self.active_run = row["run_id"]
                        self.active = asyncio.create_task(self.execute(row["run_id"]))
                        await asyncio.gather(self.active, return_exceptions=True)
                        self.active = None
                        self.active_run = None
                    await asyncio.sleep(1)
            finally:
                await guard.execute("SELECT pg_advisory_unlock(720260907)")

    async def checkpoint(self, run_id, stage, count, total):
        await self.store.checkpoint(
            run_id, {"stage": stage, "completed": count, "total": total}
        )

    async def execute(self, run_id):
        job = await self.store.get(run_id)
        plan = job["plan"]
        active_search = {}
        try:
            await self.store.record(
                run_id,
                {
                    "stage": "companies"
                    if job.get("target") == "companies"
                    else "search",
                    "message": "开始执行；已完成的采集项将从断点继续。",
                    "outcome": "running",
                },
            )
            await self.checkpoint(
                run_id,
                "companies" if job.get("target") == "companies" else "search",
                0,
                self.config.acquisition_patent_limit,
            )
            async with self.browser_factory(self.config) as browser:
                discovered = await self.store.items(run_id, "discovered")
                pages = await self.store.items(run_id, "page")
                searches = []
                for direction in plan["directions"]:
                    keywords = direction["keywords"] or [direction["name"]]
                    for index, keyword in enumerate(keywords):
                        cursor = (
                            direction["domain_id"]
                            if len(keywords) == 1
                            else f"{direction['domain_id']}:{index}"
                        )
                        searches.append((cursor, direction, keyword))
                ended = set()
                for page in range(0 if job.get("target") == "companies" else 100):
                    for cursor, direction, keyword in searches:
                        if cursor in ended:
                            continue
                        page_key = f"{cursor}:{page}"
                        if page_key in pages:
                            if pages[page_key].get("end"):
                                ended.add(cursor)
                            continue
                        if len(discovered) >= self.config.acquisition_patent_limit:
                            break
                        await self.checkpoint(
                            run_id,
                            "search",
                            len(discovered),
                            self.config.acquisition_patent_limit,
                        )
                        active_search = {
                            "stage": "search",
                            "direction": direction["name"],
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
                        rows = await browser.search(active_search["url"])
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
                            if (
                                key not in discovered
                                and len(discovered)
                                >= self.config.acquisition_patent_limit
                            ):
                                break
                            existing = discovered.get(key, {**row, "domain_ids": []})
                            if direction["domain_id"] not in existing["domain_ids"]:
                                existing["domain_ids"].append(direction["domain_id"])
                            discovered[key] = existing
                            await self.store.save(run_id, "discovered", key, existing)
                        ids = [r["publication_number"] for r in rows]
                        previous = pages.get(f"{cursor}:{page - 1}", {})
                        end = not rows or ids == previous.get("ids")
                        pages[page_key] = {"end": end, "ids": ids}
                        await self.store.save(run_id, "page", page_key, pages[page_key])
                        await self.store.record(
                            run_id,
                            {
                                **active_search,
                                "message": "本页检索完成",
                                "outcome": "completed",
                                "count": len(rows),
                                "completed": len(discovered),
                            },
                        )
                        active_search = {}
                        if end:
                            ended.add(cursor)
                    if len(discovered) >= self.config.acquisition_patent_limit or len(
                        ended
                    ) == len(searches):
                        break
                patents = await self.store.items(run_id, "patent")
                for key, listing in (
                    [] if job.get("target") == "companies" else discovered.items()
                ):
                    await self.checkpoint(
                        run_id, "patents", len(patents), len(discovered)
                    )
                    if key not in patents:
                        record = await browser.patent(key, listing)
                        if record["publication_number"] != key:
                            raise AcquisitionBlocked(
                                "PARSE_CHANGED", "详情公开号与检索记录不一致"
                            )
                        record.update(
                            list_assignees=listing["list_assignees"],
                            list_source=listing.get("list_source"),
                            domain_ids=listing["domain_ids"],
                        )
                        await self.store.save(run_id, "patent", key, record)
                        patents[key] = record
                if job.get("target") == "patents":
                    await self.checkpoint(
                        run_id, "patents", len(patents), len(discovered)
                    )
                    await self.store.record(
                        run_id,
                        {
                            "stage": "patents",
                            "message": "专利采集完成，等待你开始企业发现。",
                            "outcome": "completed",
                            "completed": len(patents),
                        },
                    )
                    await self.store.complete_patents(run_id)
                    return
                names = {
                    normalized(name): name
                    for p in patents.values()
                    for name in p.get("list_assignees", [])
                    + p["current_assignees"]
                    + p["original_assignees"]
                    if domestic_candidate(name)
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
                        if record["status"] == "matched":
                            await self.store.cache_company(key, record)
                    await self.store.save(run_id, "company", key, record)
                    companies[key] = record
                    await self.store.record(
                        run_id,
                        {
                            "stage": "companies",
                            "direction": name,
                            "message": "企业信息查询完成"
                            if record["status"] == "matched"
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
            status = "paused" if exc.code == "PAUSED" else "waiting"
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
