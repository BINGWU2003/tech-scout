from pathlib import Path

from psycopg.types.json import Jsonb

from .models import AcquisitionBlocked


class Store:
    def __init__(self, pool):
        self.pool = pool

    async def migrate(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
            )

    async def create(self, run_id, plan):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO ingestion.job(run_id,plan) VALUES (%s,%s) "
                "ON CONFLICT DO NOTHING",
                (run_id, Jsonb(plan)),
            )
        job = await self.get(run_id)
        if job["plan"] != plan:
            raise ValueError("同一研究运行不能更换已确认的检索计划")
        return job

    async def get(self, run_id):
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM ingestion.job WHERE run_id=%s", (run_id,)
            )
            return await cur.fetchone()

    async def update(self, run_id, status, progress=None, error=None):
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE ingestion.job SET status=%s, "
                "progress=COALESCE(%s,progress),error=%s,updated_at=now() "
                "WHERE run_id=%s",
                (
                    status,
                    Jsonb(progress) if progress is not None else None,
                    Jsonb(error) if error else None,
                    run_id,
                ),
            )

    async def items(self, run_id, kind):
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT key,data FROM ingestion.item WHERE run_id=%s AND kind=%s "
                "ORDER BY key",
                (run_id, kind),
            )
            return {r["key"]: r["data"] for r in await cur.fetchall()}

    async def checkpoint(self, run_id, progress):
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE ingestion.job SET status='running', progress=%s, "
                "error=NULL,updated_at=now() WHERE run_id=%s "
                "AND status IN ('queued','running') RETURNING run_id",
                (Jsonb(progress), run_id),
            )
            if not await cur.fetchone():
                raise AcquisitionBlocked("PAUSED", "采集已暂停，可继续")

    async def save(self, run_id, kind, key, data):
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute(
                "INSERT INTO ingestion.item(run_id,kind,key,data) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (run_id,kind,key) DO UPDATE "
                "SET data=excluded.data,updated_at=now()",
                (run_id, kind, key, Jsonb(data)),
            )
            if kind == "patent":
                await conn.execute(
                    "INSERT INTO catalog_v2.patent VALUES (%s,%s,now()) "
                    "ON CONFLICT(publication_number) DO UPDATE "
                    "SET data=excluded.data,updated_at=now()",
                    (key, Jsonb(data)),
                )
            if kind == "company":
                for company in data.get("companies", []):
                    await conn.execute(
                        "INSERT INTO catalog_v2.company VALUES (%s,%s,%s,now()) "
                        "ON CONFLICT(credit_code) DO UPDATE "
                        "SET data=excluded.data,updated_at=now()",
                        (company["company_id"], company["credit_code"], Jsonb(company)),
                    )

    async def cached_company(self, query, days):
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT data FROM ingestion.company_cache WHERE query=%s "
                "AND updated_at>now()-(%s * interval '1 day')",
                (query, days),
            )
            row = await cur.fetchone()
            return row["data"] if row else None

    async def cache_company(self, query, data):
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO ingestion.company_cache VALUES(%s,%s,now()) "
                "ON CONFLICT(query) DO UPDATE SET data=excluded.data,updated_at=now()",
                (query, Jsonb(data)),
            )

    async def snapshot(self, run_id):
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT snapshot FROM catalog_v2.release WHERE release_id=%s", (run_id,)
            )
            row = await cur.fetchone()
            return row["snapshot"] if row else None

    async def publish(self, run_id, snapshot):
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT status FROM ingestion.job WHERE run_id=%s FOR UPDATE",
                (run_id,),
            )
            if (await cur.fetchone())["status"] != "running":
                raise AcquisitionBlocked("PAUSED", "采集已暂停，可继续")
            await conn.execute(
                "INSERT INTO catalog_v2.release(release_id,snapshot) VALUES (%s,%s) "
                "ON CONFLICT DO NOTHING",
                (run_id, Jsonb(snapshot)),
            )
            await conn.execute(
                "UPDATE ingestion.job SET status='completed',error=NULL,"
                "updated_at=now() "
                "WHERE run_id=%s",
                (run_id,),
            )
