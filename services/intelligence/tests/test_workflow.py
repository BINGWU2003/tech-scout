import copy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from tech_scout_intelligence.models import Analysis, Explanation, Plan, ResearchError
from tech_scout_intelligence.store import validate_decisions
from tech_scout_intelligence.workflow import (
    build_graph,
    company_workset,
    evidence_findings,
    patent_workset,
    rank,
)


def sample():
    return {
        "release": {
            "release_id": "v1",
            "period_from_year": 2019,
            "period_to_year": 2025,
        },
        "domains": [{"domain_id": "vision", "name": "工业视觉", "definition": {}}],
        "patents": [
            {
                "patent_id": "p1",
                "patent_title": "Edge neural vision",
                "grant_year": 2025,
                "source_sha256": "a" * 64,
            }
        ],
        "patent-classifications": [
            {"patent_id": "p1", "cpc_group": "G06N3/04"},
            {"patent_id": "p1", "cpc_group": "G06T7/00"},
        ],
        "patent-domain-matches": [
            {"patent_id": "p1", "domain_id": "vision", "total_score": 8}
        ],
        "patent-parties": [
            {
                "patent_id": "p1",
                "patent_party_id": "party1",
                "party_role": "assignee",
                "party_name": "Acme",
                "party_name_normalized": "ACME",
                "country": "US",
            }
        ],
        "companies": [
            {
                "company_id": "c1",
                "preferred_name": "Acme",
                "legal_name": "Acme",
                "country": "US",
            }
        ],
        "company-patent-relations": [
            {
                "patent_id": "p1",
                "company_id": "c1",
                "patent_party_id": "party1",
                "candidate_id": "candidate1",
            }
        ],
        "company-candidates": [
            {"candidate_id": "candidate1", "name_normalized": "ACME", "country": "US"}
        ],
        "entity-review-decisions": [],
        "entity-matches": [],
        "entity-evidence": [
            {
                "candidate_id": "candidate1",
                "evidence_id": "e1",
                "legal_name": "Acme",
                "country": "US",
            }
        ],
        "external-identifiers": [],
        "company-aliases": [],
        "company-relations": [],
    }


def test_evidence_findings_deduplicate_and_expose_identity_conflicts():
    snapshot = sample()
    first = {
        **snapshot["entity-evidence"][0],
        "identifier_type": "registration",
        "identifier_value": "A",
        "preserved": True,
        "content_sha256": "a" * 64,
        "source_sha256": "b" * 64,
        "source_path": "evidence/source.json",
    }
    second = {
        **first,
        "evidence_id": "e2",
        "identifier_value": "B",
        "preserved": False,
        "content_sha256": None,
        "source_path": None,
    }
    snapshot["entity-evidence"] = [first, dict(first), second]
    findings = evidence_findings(
        snapshot,
        [
            {
                "candidate_id": "candidate1",
                "requires_confirmation": True,
                "catalog_decision": "rejected",
            }
        ],
    )
    assert len(findings["identity_evidence"]) == 2
    assert findings["conflicts"][0]["values"] == {"A": ["e1"], "B": ["e2"]}
    assert findings["conflicts"][1]["kind"] == "relation_review_conflict"
    complete, missing = findings["identity_evidence"]
    assert complete["has_content_hash"] and complete["has_source_locator"]
    assert not missing["preserved"] and not missing["has_source_locator"]
    assert all(
        e["scope"] == "identity_only" and not e["original_text_available"]
        for e in findings["identity_evidence"]
    )


def plan():
    return Plan(
        directions=[
            {
                "domain_id": "vision",
                "name": "视觉",
                "keywords": ["vision"],
                "cpc_prefixes": ["G06N"],
                "explanation": "标题和分类",
            }
        ],
        from_year=2019,
        to_year=2025,
    )


class FakeCatalog:
    def __init__(self):
        self.data = sample()
        self.reads = 0

    async def read(self, expected_release=None):
        self.reads += 1
        if expected_release and expected_release != self.data["release"]["release_id"]:
            raise ResearchError("RELEASE_CHANGED", "数据版本改变")
        if expected_release:
            return copy.deepcopy(self.data)
        return {
            "release": copy.deepcopy(self.data["release"]),
            "domains": copy.deepcopy(self.data["domains"]),
        }


class FakeLLM:
    def __init__(self):
        self.calls = []
        self.fail = None

    async def generate(self, run_id, lease, instruction, payload, schema):
        self.calls.append(schema.__name__)
        if self.fail == schema.__name__:
            raise ResearchError("MODEL_REQUEST_FAILED", "模型失败")
        if schema is Plan:
            return plan()
        return Analysis(
            companies=[
                Explanation(
                    company_id=c["company_id"],
                    summary="标题与 CPC 表明相关性，属于推断",
                    patent_ids=[p["patent_id"] for p in c["patents"]],
                )
                for c in payload["companies"]
            ]
        )


def test_dedup_filters_and_deterministic_ranking():
    snapshot = sample()
    snapshot["company-patent-relations"] *= 3
    snapshot["patent-domain-matches"] *= 2
    patents = patent_workset(snapshot, plan())
    companies, unresolved = company_workset(snapshot, patents)
    assert len(patents) == 1
    assert not unresolved
    assert rank(companies, patents)[0]["patent_count"] == 1
    assert rank(companies, patents)[0]["grant_year_trend"] == {"2025": 1}
    excluded = plan()
    excluded.directions[0].excluded_keywords = ["neural"]
    assert patent_workset(snapshot, excluded) == []


@pytest.mark.asyncio
async def test_confirmation_and_failed_node_retry_do_not_repeat_planner():
    catalog, llm, store = FakeCatalog(), FakeLLM(), AsyncMock()
    graph = build_graph(catalog, llm, store, InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}
    await graph.ainvoke({"question": "工业视觉"}, config)
    assert (await graph.aget_state(config)).next == ("plan_gate",)
    assert catalog.reads == 1
    assert llm.calls == ["Plan"]
    llm.fail = "Analysis"
    with pytest.raises(ResearchError):
        await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    state = await graph.aget_state(config)
    assert state.next == ("evidence",)
    assert "result" not in state.values
    assert (
        state.values["snapshot"]["patents"][0]["patent_title"] == "Edge neural vision"
    )
    catalog.data["patents"][0]["patent_title"] = "NEW PUBLISHED VALUE"
    catalog.data["release"]["release_id"] = "v2"
    llm.fail = None
    await graph.ainvoke(None, config)
    result = (await graph.aget_state(config)).values
    assert result["result"]["companies"][0]["patent_count"] == 1
    assert result["snapshot"]["patents"][0]["patent_title"] == "Edge neural vision"
    assert catalog.reads == 2
    assert llm.calls == ["Plan", "Analysis", "Analysis"]


@pytest.mark.asyncio
async def test_release_changes_before_confirmation_stop_snapshot():
    catalog, llm = FakeCatalog(), FakeLLM()
    graph = build_graph(catalog, llm, AsyncMock(), InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}
    await graph.ainvoke({"question": "视觉"}, config)
    catalog.data["release"]["release_id"] = "v2"
    with pytest.raises(ResearchError, match="数据版本改变"):
        await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    assert (await graph.aget_state(config)).next == ("snapshot",)
    assert llm.calls == ["Plan"]


@pytest.mark.asyncio
async def test_unverified_can_be_skipped_and_excluded_review_not_reopened():
    catalog, llm = FakeCatalog(), FakeLLM()
    catalog.data["company-patent-relations"] = []
    graph = build_graph(catalog, llm, AsyncMock(), InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}
    await graph.ainvoke({"question": "视觉"}, config)
    await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    assert (await graph.aget_state(config)).next == ("entity",)
    payload = {
        "decisions": [{"candidate_id": "candidate1", "action": "skip"}],
        "actor_id": str(uuid4()),
        "action_id": str(uuid4()),
        "submitted_at": "2026-09-06T00:00:00Z",
    }
    await graph.ainvoke(Command(resume=payload), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["companies"] == []
    assert result["unverified"][0]["patent_ids"] == ["p1"]
    catalog.data["entity-review-decisions"] = [
        {"candidate_id": "candidate1", "decision": "non_company"}
    ]
    _, unresolved = company_workset(catalog.data, patent_workset(catalog.data, plan()))
    assert unresolved[0]["requires_confirmation"] is False
    assert llm.calls == ["Plan"]


def test_identity_evidence_must_support_selected_company():
    snapshot = sample()
    artifacts = {
        "snapshot": snapshot,
        "unverified": [{"candidate_id": "candidate1", "requires_confirmation": True}],
    }
    decision = [
        {
            "candidate_id": "candidate1",
            "action": "confirm",
            "company_id": "c1",
            "evidence_ids": ["e1"],
        }
    ]
    validate_decisions(decision, artifacts)
    snapshot["entity-evidence"][0]["legal_name"] = "Different Company"
    with pytest.raises(ResearchError, match="证据未支持"):
        validate_decisions(decision, artifacts)


@pytest.mark.asyncio
async def test_no_result_does_not_broaden_or_call_analysis():
    catalog, llm = FakeCatalog(), FakeLLM()
    graph = build_graph(catalog, llm, AsyncMock(), InMemorySaver())
    config = {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}
    await graph.ainvoke({"question": "视觉"}, config)
    manual = plan()
    manual.directions[0].keywords = ["absent"]
    await graph.ainvoke(Command(resume={"plan": manual.model_dump()}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["patent_count"] == 0
    assert result["empty_reason"]
    assert llm.calls == ["Plan"]
