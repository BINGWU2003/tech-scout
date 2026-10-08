import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from tech_scout_intelligence.acquisition import Acquisition
from tech_scout_intelligence.models import ResearchError


class MemoryAcquisitionStore:
    def __init__(self, snapshot):
        self.snapshot_value = snapshot
        self.jobs = [
            {"status": "queued", "progress": {"stage": "search", "completed": 0}},
            {
                "status": "completed",
                "progress": {"stage": "snapshot", "completed": 1},
            },
        ]

    async def events(self, run_id, after):
        return []

    async def create(self, run_id, plan):
        return self.jobs[0]

    async def get(self, run_id):
        await asyncio.sleep(0)
        return self.jobs.pop(0) if len(self.jobs) > 1 else self.jobs[0]

    async def snapshot(self, run_id):
        return self.snapshot_value


@pytest.mark.asyncio
async def test_research_collects_from_in_process_acquisition_without_http():
    expected = {"release": {"release_id": "same-process"}, "patents": []}
    acquisition = Acquisition(MemoryAcquisitionStore(expected), poll_seconds=0)
    progress = []

    async def publish(value):
        progress.append(value)

    result = await acquisition.collect(uuid4(), {"directions": []}, publish)

    assert result == expected
    assert progress[-1]["status"] == "completed"


@pytest.mark.asyncio
async def test_fast_search_logs_are_drained_and_resume_cursor_avoids_duplicates():
    class LoggedStore(MemoryAcquisitionStore):
        async def events(self, run_id, after):
            return [
                {
                    "sequence": i,
                    "created_at": datetime.now(UTC),
                    "data": {
                        "stage": "search",
                        "message": str(i),
                        "outcome": "completed",
                    },
                }
                for i in range(after + 1, min(after + 101, 206))
            ]

    store = LoggedStore({"patents": []})
    acquisition = Acquisition(store, poll_seconds=0)
    seen = []

    async def publish(value):
        if "process" in value:
            seen.append(value["acquisition_cursor"])

    await acquisition.collect(uuid4(), {}, publish, after=3)
    assert seen == list(range(4, 206))
    seen.clear()
    await acquisition.collect(uuid4(), {}, publish, after=205)
    assert seen == []


@pytest.mark.asyncio
async def test_acquisition_timeout_pauses_job_and_allows_retry():
    class WaitingStore(MemoryAcquisitionStore):
        def __init__(self):
            super().__init__({"patents": []})
            self.jobs = [self.jobs[0]]
            self.update = AsyncMock()

    store = WaitingStore()
    acquisition = Acquisition(store, poll_seconds=0.001, timeout_seconds=0.01)
    run_id = uuid4()
    progress = AsyncMock()
    with pytest.raises(ResearchError) as error:
        await acquisition.collect(run_id, {}, progress)
    assert error.value.code == "ACQUISITION_TIMEOUT"
    store.update.assert_awaited_once_with(
        run_id,
        "paused",
        error={"code": "ACQUISITION_TIMEOUT", "message": "采集超过六小时时限，可重试"},
    )
