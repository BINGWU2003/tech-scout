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
        try:
            await self.checkpoint(
                run_id, "search", 0, self.config.acquisition_patent_limit
            )
            async with self.browser_factory(self.config) as browser:
                discovered = await self.store.items(run_id, "discovered")
                pages = await self.store.items(run_id, "page")
                ended = set()
                for page in range(100):
                    for direction in plan["directions"]:
                        if direction["domain_id"] in ended:
                            continue
                        page_key = f"{direction['domain_id']}:{page}"
                        if page_key in pages:
                            if pages[page_key].get("end"):
                                ended.add(direction["domain_id"])
                            continue
                        if len(discovered) >= self.config.acquisition_patent_limit:
                            break
                        await self.checkpoint(
                            run_id,
                            "search",
                            len(discovered),
                            self.config.acquisition_patent_limit,
                        )
                        rows = await browser.search(search_url(direction, plan, page))
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
                        previous = pages.get(f"{direction['domain_id']}:{page - 1}", {})
                        end = not rows or ids == previous.get("ids")
                        pages[page_key] = {"end": end, "ids": ids}
                        await self.store.save(run_id, "page", page_key, pages[page_key])
                        if end:
                            ended.add(direction["domain_id"])
                    if len(discovered) >= self.config.acquisition_patent_limit or len(
                        ended
                    ) == len(plan["directions"]):
                        break
                patents = await self.store.items(run_id, "patent")
                for key, listing in discovered.items():
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
                    record = await self.store.cached_company(
                        key, self.config.acquisition_company_cache_days
                    )
                    if record is None:
                        record = await browser.company(name)
                        if record["status"] == "matched":
                            await self.store.cache_company(key, record)
                    await self.store.save(run_id, "company", key, record)
                    companies[key] = record
                await self.checkpoint(run_id, "snapshot", len(patents), len(discovered))
                await self.store.publish(
                    run_id, build_snapshot(run_id, plan, patents, companies)
                )
        except AcquisitionBlocked as exc:
            status = "paused" if exc.code == "PAUSED" else "waiting"
            error = {"code": exc.code, "message": exc.message}
            if exc.retry_after:
                error["retry_at"] = (
                    datetime.now(UTC) + timedelta(seconds=exc.retry_after)
                ).isoformat()
            await self.store.update(run_id, status, error=error)
        except asyncio.CancelledError:
            await self.store.update(
                run_id,
                "paused",
                error={"code": "WORKER_INTERRUPTED", "message": "采集进程中断，可继续"},
            )
            raise
        except Exception:
            await self.store.update(
                run_id,
                "failed",
                error={
                    "code": "ACQUISITION_FAILED",
                    "message": "采集失败，已保留完成项，可重试",
                },
            )
