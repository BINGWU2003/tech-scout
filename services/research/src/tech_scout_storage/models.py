"""Mappings of existing tables. DDL remains owned by the existing migrations."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONB, datetime: DateTime(timezone=True)}


class DeletedRun(Base):
    __tablename__ = "deleted_run"
    __table_args__ = {"schema": "agent_runtime"}
    run_id: Mapped[UUID] = mapped_column(primary_key=True)


class ResearchRun(Base):
    __tablename__ = "research_run"
    __table_args__ = {"schema": "agent_runtime"}
    run_id: Mapped[UUID] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="queued")
    sequence: Mapped[int] = mapped_column(server_default="0")
    node: Mapped[str | None] = mapped_column(Text)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    artifacts: Mapped[dict[str, Any]] = mapped_column(
        server_default=text("'{}'::jsonb")
    )
    budget: Mapped[dict[str, Any]]
    command: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    lease: Mapped[UUID | None]
    heartbeat: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ResearchEvent(Base):
    __tablename__ = "research_event"
    __table_args__ = {"schema": "agent_runtime"}
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("agent_runtime.research_run.run_id"), primary_key=True
    )
    sequence: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    data: Mapped[dict[str, Any]]


class ResearchAction(Base):
    __tablename__ = "research_action"
    __table_args__ = {"schema": "agent_runtime"}
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("agent_runtime.research_run.run_id"), primary_key=True
    )
    action_id: Mapped[UUID] = mapped_column(primary_key=True)
    payload: Mapped[dict[str, Any]]


class Job(Base):
    __tablename__ = "job"
    __table_args__ = {"schema": "ingestion"}
    run_id: Mapped[UUID] = mapped_column(primary_key=True)
    plan: Mapped[dict[str, Any]]
    target: Mapped[str] = mapped_column(Text, server_default="patents")
    company_targets: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    status: Mapped[str] = mapped_column(Text, server_default="queued")
    progress: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class IngestionEvent(Base):
    __tablename__ = "event"
    __table_args__ = (
        Index("ingestion_event_run_sequence", "run_id", "sequence"),
        {"schema": "ingestion"},
    )
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[UUID]
    data: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Item(Base):
    __tablename__ = "item"
    __table_args__ = {"schema": "ingestion"}
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("ingestion.job.run_id"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    data: Mapped[dict[str, Any]]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CompanyCache(Base):
    __tablename__ = "company_cache"
    __table_args__ = {"schema": "ingestion"}
    query: Mapped[str] = mapped_column(Text, primary_key=True)
    data: Mapped[dict[str, Any]]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Patent(Base):
    __tablename__ = "patent"
    __table_args__ = {"schema": "catalog_v2"}
    publication_number: Mapped[str] = mapped_column(Text, primary_key=True)
    data: Mapped[dict[str, Any]]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Company(Base):
    __tablename__ = "company"
    __table_args__ = {"schema": "catalog_v2"}
    company_id: Mapped[UUID] = mapped_column(primary_key=True)
    credit_code: Mapped[str] = mapped_column(Text, unique=True)
    data: Mapped[dict[str, Any]]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Release(Base):
    __tablename__ = "release"
    __table_args__ = {"schema": "catalog_v2"}
    release_id: Mapped[UUID] = mapped_column(
        ForeignKey("ingestion.job.run_id"), primary_key=True
    )
    snapshot: Mapped[dict[str, Any]]
    published_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RecordSource(Base):
    __tablename__ = "record_source"
    __table_args__ = (
        Index("record_source_run_idx", "run_id"),
        {"schema": "catalog_v2"},
    )
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    record_id: Mapped[str] = mapped_column(Text, primary_key=True)
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("ingestion.job.run_id"), primary_key=True
    )
    data: Mapped[dict[str, Any]]


class RunProjection(Base):
    __tablename__ = "run_projection"
    __table_args__ = {"schema": "catalog_v2"}
    run_id: Mapped[UUID] = mapped_column(
        ForeignKey("ingestion.job.run_id"), primary_key=True
    )
    snapshot: Mapped[dict[str, Any]]
