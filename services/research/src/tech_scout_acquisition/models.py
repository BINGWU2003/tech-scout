from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Direction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    domain_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    excluded_keywords: list[str] = Field(default_factory=list, max_length=12)
    cpc_prefixes: list[str] = Field(default_factory=list, max_length=12)
    explanation: str = Field(default="", max_length=2000)


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    directions: list[Direction] = Field(min_length=1, max_length=3)
    from_year: int = Field(ge=1800, le=2100)
    to_year: int = Field(ge=1800, le=2100)
    risks: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def valid(self):
        if self.from_year > self.to_year:
            raise ValueError("起始年份不能晚于结束年份")
        ids = [d.domain_id for d in self.directions]
        if len(ids) != len(set(ids)):
            raise ValueError("方向标识不能重复")
        for d in self.directions:
            for term in d.keywords + d.excluded_keywords + d.cpc_prefixes:
                if not term.strip() or len(term) > 200:
                    raise ValueError("检索词不能为空或超过 200 字符")
        return self


class Operation(BaseModel):
    kind: Literal["pause", "resume"]


class AcquisitionBlocked(Exception):
    def __init__(self, code, message, retry_after=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after = retry_after
