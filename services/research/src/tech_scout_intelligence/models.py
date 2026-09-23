"""Validated internal protocol. No product database types cross this boundary."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DirectionDraft(Model):
    domain_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    explanation: str = Field(min_length=1, max_length=2000)
    keywords: list[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
        ]
    ] = Field(default_factory=list, max_length=12)


class Keywords(Model):
    keywords: list[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
        ]
    ] = Field(min_length=1, max_length=12)


class DirectionProposal(Model):
    reply: str = Field(min_length=1, max_length=4000)
    directions: list[DirectionDraft] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def candidate_keywords(self):
        if any(not direction.keywords for direction in self.directions):
            raise ValueError("推荐方向必须包含检索关键词")
        return self


class Direction(Model):
    domain_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    excluded_keywords: list[str] = Field(default_factory=list, max_length=12)
    cpc_prefixes: list[str] = Field(default_factory=list, max_length=12)
    explanation: str = Field(max_length=2000)


class Plan(Model):
    pages_per_keyword: Literal[3, 5, 10] = 5
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
    conversation: dict[str, Any] = Field(default_factory=dict)


class SelectedPlan(Plan):
    directions: list[Direction] = Field(default_factory=list, max_length=3)


class ConversationReply(Model):
    intent: Literal[
        "discuss", "refresh_candidates", "update_candidate", "propose_selected"
    ]
    reply: str = Field(min_length=1, max_length=4000)
    updates: list[DirectionDraft] = Field(default_factory=list, max_length=3)
    remove_ids: list[str] = Field(default_factory=list, max_length=3)
    from_year: int | None = Field(default=None, ge=1800, le=2100)
    to_year: int | None = Field(default=None, ge=1800, le=2100)

    @model_validator(mode="after")
    def candidate_keywords(self):
        if self.intent in {"refresh_candidates", "update_candidate"} and any(
            not direction.keywords for direction in self.updates
        ):
            raise ValueError("推荐方向必须包含检索关键词")
        return self


class Action(Model):
    action_id: UUID
    kind: Literal[
        "confirm_plan",
        "start_companies",
        "retry",
        "cancel",
        "pause",
    ]
    actor_id: UUID
    plan: Plan | None = None

    @model_validator(mode="after")
    def valid_payload(self):
        if self.kind == "confirm_plan" and self.plan is None:
            raise ValueError("确认计划需要 plan")
        if self.kind != "confirm_plan" and self.plan is not None:
            raise ValueError("当前动作不接受 plan")
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
    max_requests: int = 300
    max_seconds: int = 3600
    max_cny: float = 10


Status = Literal[
    "queued",
    "running",
    "awaiting_plan",
    "awaiting_companies",
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


class PatentAssessment(Model):
    patent_id: str
    priority: Literal["high", "medium", "low"]
    reason: str = Field(min_length=1, max_length=1000)


class PatentAssessmentBatch(Model):
    patents: list[PatentAssessment] = Field(max_length=20)


class CompanyAssessment(Model):
    company_id: str
    priority: Literal["high", "medium", "low"]
    summary: str = Field(min_length=1, max_length=2000)
    patent_ids: list[str] = Field(max_length=20)


class CompanyAssessmentBatch(Model):
    companies: list[CompanyAssessment] = Field(max_length=10)


class ResearchError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
