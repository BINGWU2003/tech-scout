"""Internal HTTP boundary. Research never imports the browser worker."""

import asyncio
from contextlib import suppress
from datetime import UTC, datetime

import httpx

from .models import ResearchError


class Acquisition:
    def __init__(self, config):
        self.url = config.acquisition_base_url.rstrip("/")
        self.token = config.acquisition_internal_token.get_secret_value()

    async def context(self):
        # No collection requests or fact writes before confirmation.
        return {
            "source_mode": "browser",
            "domains": [],
            "release": {},
            "period_from_year": 1800,
            "period_to_year": datetime.now(UTC).year,
        }

    async def collect(self, run_id, plan, progress):
        if not self.token:
            raise ResearchError(
                "ACQUISITION_UNCONFIGURED", "请配置采集服务地址和内部令牌"
            )
        path = f"/jobs/{run_id}"
        async with httpx.AsyncClient(
            base_url=self.url,
            timeout=45,
            headers={"Authorization": "Bearer " + self.token},
        ) as client:
            try:
                response = await client.post(path, json=plan)
                response.raise_for_status()
                job = response.json()
                if job["status"] in {"waiting", "paused", "failed"}:
                    response = await client.post(
                        path + "/actions", json={"kind": "resume"}
                    )
                    if response.status_code == 409:
                        error = job.get("error") or {}
                        raise ResearchError(
                            error.get("code", "ACQUISITION_WAITING"),
                            error.get("message", "采集等待恢复"),
                        )
                    response.raise_for_status()
                previous = None
                while True:
                    response = await client.get(path)
                    response.raise_for_status()
                    job = response.json()
                    view = {
                        "status": job["status"],
                        **job["progress"],
                        "error": job.get("error"),
                    }
                    if view != previous:
                        await progress(view)
                        previous = view
                    if job["status"] == "completed":
                        response = await client.get(path + "/snapshot")
                        response.raise_for_status()
                        return response.json()
                    if job["status"] in {"waiting", "paused", "failed"}:
                        error = job.get("error") or {}
                        raise ResearchError(
                            error.get("code", "ACQUISITION_WAITING"),
                            error.get("message", "采集已暂停，可重试"),
                        )
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                with suppress(Exception):
                    await client.post(path + "/actions", json={"kind": "pause"})
                raise
            except httpx.HTTPError:
                with suppress(Exception):
                    await client.post(path + "/actions", json={"kind": "pause"})
                raise ResearchError(
                    "ACQUISITION_UNAVAILABLE", "采集服务不可用，请检查本机服务后重试"
                ) from None
            except ResearchError as exc:
                if exc.code == "LEASE_LOST":
                    with suppress(Exception):
                        await client.post(path + "/actions", json={"kind": "pause"})
                raise
