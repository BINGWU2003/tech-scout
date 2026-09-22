"""In-process boundary between the research workflow and browser acquisition."""

import asyncio
from contextlib import suppress
from datetime import UTC, datetime

from .models import ResearchError


class Acquisition:
    def __init__(self, store, poll_seconds=1):
        self.store = store
        self.poll_seconds = poll_seconds

    async def context(self):
        # No collection requests or fact writes before confirmation.
        return {
            "source_mode": "browser",
            "domains": [],
            "release": {},
            "period_from_year": 1800,
            "period_to_year": datetime.now(UTC).year,
        }

    async def collect(
        self, run_id, plan, progress, after=0, phase="patents", company_targets=None
    ):
        job = await self.store.create(run_id, plan)
        if phase == "companies" and job["status"] == "awaiting_companies":
            await self.store.start_companies(run_id, company_targets or [])
            job = await self.store.get(run_id)
        if job["status"] in {"waiting", "paused", "failed"}:
            retry_at = (job.get("error") or {}).get("retry_at")
            if retry_at and datetime.fromisoformat(retry_at) > datetime.now(UTC):
                error = job.get("error") or {}
                raise ResearchError(
                    error.get("code", "ACQUISITION_WAITING"),
                    error.get("message", "采集等待恢复"),
                )
            await self.store.update(run_id, "queued", error=None)
        previous = None
        try:
            while True:
                job = await self.store.get(run_id)
                # Replay logs: latest-progress polling alone loses fast searches.
                while True:
                    events = await self.store.events(run_id, after)
                    for event in events:
                        await progress(
                            {
                                "process": {
                                    **event["data"],
                                    "occurredAt": event["created_at"].isoformat(),
                                },
                                "acquisition_cursor": event["sequence"],
                            }
                        )
                        after = event["sequence"]
                    if len(events) < 100:
                        break
                view = {
                    "status": job["status"],
                    **job["progress"],
                    "error": job.get("error"),
                }
                if view != previous:
                    await progress(view)
                    previous = view
                if phase == "patents" and job["status"] == "awaiting_companies":
                    snapshot = await self.store.patent_snapshot(run_id)
                    if snapshot is None:
                        raise ResearchError(
                            "ACQUISITION_INCOMPLETE", "专利快照尚未生成"
                        )
                    return snapshot
                if job["status"] == "completed":
                    snapshot = await self.store.snapshot(run_id)
                    if snapshot is None:
                        raise ResearchError(
                            "ACQUISITION_INCOMPLETE", "采集已完成但快照不存在"
                        )
                    return snapshot
                if job["status"] in {"waiting", "paused", "failed"}:
                    error = job.get("error") or {}
                    raise ResearchError(
                        error.get("code", "ACQUISITION_WAITING"),
                        error.get("message", "采集已暂停，可重试"),
                    )
                await asyncio.sleep(self.poll_seconds)
        except asyncio.CancelledError:
            with suppress(Exception):
                await self.store.update(run_id, "paused")
            raise
