"""Validated internal protocol. No product database types cross this boundary."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Direction(Model):
    domain_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    excluded_keywords: list[str] = Field(default_factory=list, max_length=12)
    cpc_prefixes: list[str] = Field(default_factory=list, max_length=12)
    explanation: str = Field(max_length=2000)


class Plan(Model):
    directions: list[Direction] = Field(min_length=1, max_length=3)
    from_year: int = Field(ge=1800, le=2100)
    to_year: int = Field(ge=1800, le=2100)
    risks: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def dates(self):
        if self.from_year > self.to_year:
            raise ValueError("起始年份不能晚于结束年份")
        for direction in self.directions:
            terms = (
                direction.keywords
                + direction.excluded_keywords
                + direction.cpc_prefixes
            )
            if any(not term.strip() or len(term) > 200 for term in terms):
                raise ValueError("检索词不能为空或超过 200 字符")
        return self


class Start(Model):
    run_id: UUID
    question: str = Field(min_length=1, max_length=2000)


class IdentityDecision(Model):
    candidate_id: str = Field(min_length=1, max_length=255)
    action: Literal["confirm", "reject", "skip"]
    company_id: str | None = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=2000)


class Action(Model):
    action_id: UUID
    kind: Literal["confirm_plan", "resolve_entities", "retry", "cancel", "pause"]
    actor_id: UUID
    plan: Plan | None = None
    decisions: list[IdentityDecision] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def valid_payload(self):
        if self.kind == "confirm_plan" and self.plan is None:
            raise ValueError("确认计划需要 plan")
        if self.kind != "confirm_plan" and self.plan is not None:
            raise ValueError("当前动作不接受 plan")
        if self.kind != "resolve_entities" and self.decisions:
            raise ValueError("当前动作不接受身份决定")
        return self


class Failure(Model):
    code: str
    message: str
    node: str | None = None


class Budget(Model):
    requests: int = 0
    reserved_cny: float = 0
    estimated_cny: float = 0
    elapsed_seconds: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    max_requests: int = 6
    max_seconds: int = 300
    max_cny: float = 1


Status = Literal[
    "queued",
    "running",
    "awaiting_plan",
    "awaiting_entities",
    "completed",
    "empty",
    "failed",
    "recoverable",
    "cancelled",
]


class RunView(Model):
    run_id: UUID
    status: Status
    sequence: int
    node: str | None = None
    error: Failure | None = None
    budget: Budget
    artifacts: dict[str, Any] = Field(default_factory=dict)


class Event(Model):
    sequence: int
    kind: str
    created_at: str
    data: RunView


class Explanation(Model):
    company_id: str
    summary: str = Field(min_length=1, max_length=2000)
    patent_ids: list[str] = Field(min_length=1, max_length=20)


class Analysis(Model):
    companies: list[Explanation] = Field(max_length=10)


class ResearchError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
