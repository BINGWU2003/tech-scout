from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, func, null, select, update
from sqlalchemy.dialects.postgresql import insert

from tech_scout_storage.database import Database, deletion_lock
from tech_scout_storage.models import (
    Company,
    CompanyCache,
    IngestionEvent,
    Item,
    Job,
    Patent,
    RecordSource,
    Release,
    RunProjection,
)

from .models import AcquisitionBlocked
from .snapshot import build_snapshot


class Store:
    def __init__(self, pool, database: Database):
        self.pool = pool
        self.database = database

    async def requeue_interrupted(self):
        async with self.database.transaction() as conn:
            await conn.execute(
                update(Job).where(Job.status == "running").values(status="queued")
            )

    async def next_pending(self):
        async with self.database.transaction() as conn:
            return await conn.scalar(
                select(Job.run_id)
                .where(Job.status == "queued")
                .order_by(Job.created_at)
                .limit(1)
            )

    async def record(self, run_id, data):
        async with self.database.transaction() as conn:
            await conn.execute(insert(IngestionEvent).values(run_id=run_id, data=data))

    async def events(self, run_id, after=0):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(
                    IngestionEvent.sequence,
                    IngestionEvent.data,
                    IngestionEvent.created_at,
                )
                .where(IngestionEvent.run_id == run_id, IngestionEvent.sequence > after)
                .order_by(IngestionEvent.sequence)
                .limit(100)
            )
            return [dict(r) for r in cur.mappings()]

    async def migrate(self):
        async with self.pool.connection() as conn:
            await conn.execute(
                Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"),
                prepare=False,
            )

    async def create(self, run_id, plan):
        async with self.database.transaction() as conn:
            await conn.execute(
                insert(Job)
                .values(run_id=run_id, plan=plan, target="patents")
                .on_conflict_do_nothing()
            )
        job = await self.get(run_id)
        if job is None or job["plan"] != plan:
            raise ValueError("同一研究运行不能更换已确认的检索计划")
        return job

    async def complete_patents(self, run_id):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                update(Job)
                .where(Job.run_id == run_id, Job.status == "running")
                .values(
                    status="awaiting_companies", error=null(), updated_at=func.now()
                )
                .returning(Job.run_id)
            )
            if not cur.mappings().first():
                raise AcquisitionBlocked("PAUSED", "采集已暂停，可继续")
            # Also create an empty projection when no patent was found.
            await self.refresh_projection(conn, run_id)

    async def start_companies(self, run_id, targets):
        async with self.database.transaction() as conn:
            current = (
                (
                    await conn.execute(
                        select(Job.target, Job.company_targets)
                        .where(Job.run_id == run_id)
                        .with_for_update()
                    )
                )
                .mappings()
                .first()
            )
            if current is None:
                raise AcquisitionBlocked("RUN_NOT_FOUND", "采集任务不存在")
            saved = current["company_targets"] or []
            if current["target"] == "companies" and saved != targets:
                raise AcquisitionBlocked(
                    "TARGET_CONFLICT", "企业查询目标不能在运行中变更"
                )
            await conn.execute(
                update(Job)
                .where(Job.run_id == run_id, Job.status == "awaiting_companies")
                .values(
                    target="companies",
                    company_targets=targets,
                    status="queued",
                    error=null(),
                    updated_at=func.now(),
                )
            )

    async def patent_snapshot(self, run_id):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(RunProjection.snapshot).where(RunProjection.run_id == run_id)
            )
            row = cur.mappings().first()
            return row["snapshot"] if row else None

    async def get(self, run_id):
        async with self.database.transaction() as conn:
            cur = await conn.execute(select(Job.__table__).where(Job.run_id == run_id))
            row = cur.mappings().first()
            return dict(row) if row is not None else None

    async def delete(self, run_id):
        async with self.database.transaction() as conn:
            await deletion_lock(conn, run_id, 1)
            await conn.execute(delete(Release).where(Release.release_id == run_id))
            for model in (RecordSource, RunProjection, Item, IngestionEvent, Job):
                await conn.execute(delete(model).where(model.run_id == run_id))

    async def update(self, run_id, status, progress=None, error=None):
        async with self.database.transaction() as conn:
            await conn.execute(
                update(Job)
                .where(Job.run_id == run_id)
                .values(
                    status=status,
                    progress=Job.progress if progress is None else progress,
                    error=error if error else null(),
                    updated_at=func.now(),
                )
            )

    async def items(self, run_id, kind):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(Item.key, Item.data)
                .where(Item.run_id == run_id, Item.kind == kind)
                .order_by(Item.key)
            )
            return {r["key"]: r["data"] for r in cur.mappings()}

    async def checkpoint(self, run_id, progress):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                update(Job)
                .where(Job.run_id == run_id, Job.status.in_(("queued", "running")))
                .values(
                    status="running",
                    progress=progress,
                    error=null(),
                    updated_at=func.now(),
                )
                .returning(Job.run_id)
            )
            if not cur.mappings().first():
                raise AcquisitionBlocked("PAUSED", "采集已暂停，可继续")

    async def save(self, run_id, kind, key, data):
        async with self.database.transaction() as conn:
            await conn.execute(
                insert(Item)
                .values(run_id=run_id, kind=kind, key=key, data=data)
                .on_conflict_do_update(
                    index_elements=[Item.run_id, Item.kind, Item.key],
                    set_={"data": data, "updated_at": func.now()},
                )
            )
            if kind == "patent":
                await conn.execute(
                    insert(Patent)
                    .values(publication_number=key, data=data)
                    .on_conflict_do_update(
                        index_elements=[Patent.publication_number],
                        set_={"data": data, "updated_at": func.now()},
                    )
                )
                await self.save_source(conn, run_id, kind, key, data)
            if kind == "company":
                for company in data.get("companies", []):
                    await conn.execute(
                        insert(Company)
                        .values(
                            company_id=company["company_id"],
                            credit_code=company["credit_code"],
                            data=company,
                        )
                        .on_conflict_do_update(
                            index_elements=[Company.credit_code],
                            set_={"data": company, "updated_at": func.now()},
                        )
                    )
                    await self.save_source(
                        conn, run_id, kind, company["company_id"], company
                    )
            if kind in {"patent", "company"}:
                await self.refresh_projection(conn, run_id)

    async def save_source(self, conn, run_id, kind, key, data):
        source = {
            k: data.get(k)
            for k in ("source_url", "source_sha256", "observed_at", "domain_ids")
        }
        await conn.execute(
            insert(RecordSource)
            .values(kind=kind, record_id=str(key), run_id=run_id, data=source)
            .on_conflict_do_update(
                index_elements=[
                    RecordSource.kind,
                    RecordSource.record_id,
                    RecordSource.run_id,
                ],
                set_={"data": source},
            )
        )

    async def refresh_projection(self, conn, run_id):
        job = (
            (await conn.execute(select(Job.plan).where(Job.run_id == run_id)))
            .mappings()
            .first()
        )
        if not {"from_year", "to_year", "directions"} <= job["plan"].keys():
            return
        rows = (
            (
                await conn.execute(
                    select(Item.kind, Item.key, Item.data).where(
                        Item.run_id == run_id, Item.kind.in_(("patent", "company"))
                    )
                )
            )
            .mappings()
            .all()
        )
        patents = {r["key"]: r["data"] for r in rows if r["kind"] == "patent"}
        companies = {r["key"]: r["data"] for r in rows if r["kind"] == "company"}
        snapshot = build_snapshot(run_id, job["plan"], patents, companies)
        await conn.execute(
            insert(RunProjection)
            .values(run_id=run_id, snapshot=snapshot)
            .on_conflict_do_update(
                index_elements=[RunProjection.run_id], set_={"snapshot": snapshot}
            )
        )

    async def cached_company(self, query, days):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(CompanyCache.data).where(
                    CompanyCache.query == query,
                    CompanyCache.updated_at > func.now() - timedelta(days=days),
                    CompanyCache.data["provider"].astext == "tianyancha",
                )
            )
            row = cur.mappings().first()
            return row["data"] if row else None

    async def cache_company(self, query, data):
        async with self.database.transaction() as conn:
            await conn.execute(
                insert(CompanyCache)
                .values(query=query, data=data)
                .on_conflict_do_update(
                    index_elements=[CompanyCache.query],
                    set_={"data": data, "updated_at": func.now()},
                )
            )

    async def snapshot(self, run_id):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(Release.snapshot).where(Release.release_id == run_id)
            )
            row = cur.mappings().first()
            return row["snapshot"] if row else None

    async def publish(self, run_id, snapshot):
        async with self.database.transaction() as conn:
            cur = await conn.execute(
                select(Job.status).where(Job.run_id == run_id).with_for_update()
            )
            row = cur.mappings().first()
            if row is None or row["status"] != "running":
                raise AcquisitionBlocked("PAUSED", "采集已暂停，可继续")
            await conn.execute(
                insert(Release)
                .values(release_id=run_id, snapshot=snapshot)
                .on_conflict_do_nothing()
            )
            await conn.execute(
                update(Job)
                .where(Job.run_id == run_id)
                .values(status="completed", error=null(), updated_at=func.now())
            )
