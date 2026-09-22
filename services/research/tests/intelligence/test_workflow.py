import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from pydantic import ValidationError

from tech_scout_intelligence.models import (
    Analysis,
    DirectionProposal,
    Explanation,
    Plan,
    ResearchError,
    SubjectResolution,
    SubjectResolutionBatch,
)
from tech_scout_intelligence.workflow import (
    apply_resolutions,
    assignee_workset,
    build_graph,
    conversation_update,
    patent_workset,
    rank,
    resolution_workset,
)


def runtime_store():
    store = AsyncMock()
    store.get.return_value = SimpleNamespace(artifacts={})
    return store


def plan():
    return Plan.model_validate(
        {
            "directions": [
                {
                    "domain_id": "vision",
                    "name": "视觉",
                    "keywords": ["vision"],
                    "cpc_prefixes": ["G06N"],
                    "explanation": "标题和分类",
                }
            ],
            "from_year": 2019,
            "to_year": 2025,
        }
    )


def sample():
    patents = []
    classifications = []
    matches = []
    parties = []
    assignees = []
    names = ["示例科技有限公司", "示例科技集团有限公司"]
    for index, name in enumerate(names, 1):
        patent_id = f"p{index}"
        assignee_id = f"a{index}"
        patents.append(
            {
                "patent_id": patent_id,
                "patent_title": f"Edge neural vision {index}",
                "publication_year": 2025,
                "grant_year": None,
                "abstract": "工业视觉",
                "source_sha256": "a" * 64,
            }
        )
        classifications.append({"patent_id": patent_id, "cpc_group": "G06N3/04"})
        matches.append(
            {
                "patent_id": patent_id,
                "domain_id": "vision",
                "total_score": 8,
                "evaluation_id": f"e{index}",
            }
        )
        parties.append(
            {
                "patent_id": patent_id,
                "patent_party_id": f"party{index}",
                "assignee_id": assignee_id,
                "party_role": "assignee",
                "party_name": name,
                "party_name_normalized": name.casefold(),
                "source_roles": ["current_assignee"],
                "country": None,
            }
        )
        assignees.append(
            {
                "assignee_id": assignee_id,
                "name": name,
                "name_normalized": name.casefold(),
                "query_key": name.casefold(),
                "patent_ids": [patent_id],
                "source_roles": ["current_assignee"],
            }
        )
    companies = [
        {
            "company_id": "c1",
            "preferred_name": "示例科技有限公司",
            "legal_name": "示例科技有限公司",
            "english_name": "Example Technology Co., Ltd.",
            "country": "CN",
            "business_info": {"经营状态": "存续", "注册地址": "北京市"},
            "source_sha256": "b" * 64,
        },
        {
            "company_id": "c2",
            "preferred_name": "示例技术有限公司",
            "legal_name": "示例技术有限公司",
            "english_name": None,
            "country": "CN",
            "business_info": {"经营状态": "存续", "注册地址": "上海市"},
            "source_sha256": "c" * 64,
        },
    ]
    return {
        "source_mode": "browser",
        "release": {
            "release_id": "00000000-0000-0000-0000-000000000001",
            "period_from_year": 2019,
            "period_to_year": 2025,
        },
        "domains": [{"domain_id": "vision", "name": "工业视觉", "definition": {}}],
        "patents": patents,
        "patent-classifications": classifications,
        "patent-domain-matches": matches,
        "patent-parties": parties,
        "assignee-candidates": assignees,
        "companies": companies,
        "company-aliases": [{"company_id": "c1", "alias_name": "示例科技集团有限公司"}],
        "external-identifiers": [],
        "company-search-hits": [
            {
                "assignee_id": "a1",
                "query_name": names[0],
                "company_id": "c2",
                "provider_rank": 0,
            },
            {
                "assignee_id": "a1",
                "query_name": names[0],
                "company_id": "c1",
                "provider_rank": 1,
            },
            {
                "assignee_id": "a2",
                "query_name": names[1],
                "company_id": "c1",
                "provider_rank": 0,
            },
        ],
        "evaluations": [
            {"evaluation_id": "e1"},
            {"evaluation_id": "e2"},
        ],
    }


class FakeAcquisition:
    def __init__(self):
        self.data = sample()
        self.reads = 0
        self.company_targets = None

    async def context(self):
        return {
            "source_mode": "browser",
            "domains": [],
            "period_to_year": 2026,
            "period_from_year": 1800,
        }

    async def collect(
        self,
        run_id,
        confirmed_plan,
        progress,
        after=0,
        phase="patents",
        company_targets=None,
    ):
        self.reads += 1
        if phase == "companies":
            self.company_targets = copy.deepcopy(company_targets)
            return copy.deepcopy(self.data)
        result = copy.deepcopy(self.data)
        result["companies"] = []
        result["company-aliases"] = []
        result["company-search-hits"] = []
        return result


class FakeLLM:
    def __init__(self):
        self.calls: list[str] = []
        self.fail: str | None = None
        self.payloads = []
        self.search_plan = plan()
        self.invalid_resolution: str | None = None
        self.invalid_analysis = False

    async def generate(self, run_id, lease, instruction, payload, schema):
        self.calls.append(schema.__name__)
        self.payloads.append(payload)
        if self.fail == schema.__name__:
            raise ResearchError("MODEL_REQUEST_FAILED", "模型失败")
        if schema is DirectionProposal:
            return DirectionProposal(
                reply="建议从工业视觉方向展开研究。",
                directions=[
                    {
                        "domain_id": d.domain_id,
                        "name": d.name,
                        "explanation": d.explanation,
                    }
                    for d in plan().directions
                ],
            )
        if schema is Plan:
            return self.search_plan.model_copy(deep=True)
        if schema is SubjectResolutionBatch:
            if self.invalid_resolution:
                if self.invalid_resolution == "invalid_confidence":
                    try:
                        SubjectResolution(
                            assignee_id=payload["subjects"][0]["assignee_id"],
                            status="matched",
                            company_id=payload["subjects"][0]["candidates"][0][
                                "company_id"
                            ],
                            confidence="low",
                            reason="非法置信度",
                        )
                    except ValidationError as exc:
                        raise ResearchError(
                            "MODEL_OUTPUT_INVALID", "模型输出不符合结构化契约"
                        ) from exc
                if self.invalid_resolution == "unknown_company":
                    return SubjectResolutionBatch(
                        resolutions=[
                            SubjectResolution(
                                assignee_id=subject["assignee_id"],
                                status="matched",
                                company_id="not-a-candidate",
                                confidence="high",
                                reason="错误选择",
                            )
                            for subject in payload["subjects"]
                        ]
                    )
                assignee_id = (
                    payload["subjects"][0]["assignee_id"]
                    if self.invalid_resolution == "duplicate"
                    else "unknown"
                )
                return SubjectResolutionBatch(
                    resolutions=[
                        SubjectResolution(
                            assignee_id=assignee_id,
                            status="unresolved",
                            reason="未知主体",
                        )
                    ]
                    * (2 if self.invalid_resolution == "duplicate" else 1)
                )
            return SubjectResolutionBatch(
                resolutions=[
                    SubjectResolution(
                        assignee_id=subject["assignee_id"],
                        status="matched" if subject["candidates"] else "unresolved",
                        company_id=(
                            subject["candidates"][0]["company_id"]
                            if subject["candidates"]
                            else None
                        ),
                        confidence="high" if subject["candidates"] else None,
                        reason=(
                            "名称与候选企业一致"
                            if subject["candidates"]
                            else "没有企业候选"
                        ),
                    )
                    for subject in payload["subjects"]
                ]
            )
        if self.invalid_analysis:
            return Analysis(
                companies=[
                    Explanation(
                        company_id=company["company_id"],
                        summary="错误引用",
                        patent_ids=["not-provided"],
                    )
                    for company in payload["companies"]
                ]
            )
        return Analysis(
            companies=[
                Explanation(
                    company_id=company["company_id"],
                    summary="标题与 CPC 表明相关性，属于推断",
                    patent_ids=[patent["patent_id"] for patent in company["patents"]],
                )
                for company in payload["companies"]
            ]
        )


def graph_config() -> RunnableConfig:
    return {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}


async def run_to_company_gate(graph, config):
    await graph.ainvoke({"question": "工业视觉"}, config)
    assert (await graph.aget_state(config)).next == ("plan_gate",)
    await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    assert (await graph.aget_state(config)).next == ("company_gate",)


def test_deterministic_assignee_candidate_and_company_ranking():
    snapshot = sample()
    patents = patent_workset(snapshot, plan())
    assignees = assignee_workset(snapshot, patents)
    assert [item["assignee_id"] for item in assignees] == ["a1", "a2"]
    subjects = resolution_workset(snapshot, assignees)
    assert [candidate["company_id"] for candidate in subjects[0]["candidates"]] == [
        "c1",
        "c2",
    ]
    resolutions = [
        {
            "assignee_id": subject["assignee_id"],
            "status": "matched",
            "company_id": "c1",
            "confidence": "high" if index == 0 else "medium",
            "reason": "名称匹配",
        }
        for index, subject in enumerate(subjects)
    ]
    companies, unresolved = apply_resolutions(snapshot, subjects, resolutions)
    assert not unresolved
    assert companies[0]["patent_ids"] == ["p1", "p2"]
    assert companies[0]["confidence"] == "medium"
    assert rank(companies, patents)[0]["patent_count"] == 2


def test_only_top_twenty_assignees_and_five_candidates_are_selected():
    snapshot = sample()
    template_patent = snapshot["patents"][0]
    template_match = snapshot["patent-domain-matches"][0]
    snapshot["patents"] = []
    snapshot["patent-classifications"] = []
    snapshot["patent-domain-matches"] = []
    snapshot["assignee-candidates"] = []
    for index in range(25):
        patent_id = f"bulk-{index:02d}"
        snapshot["patents"].append(
            {**template_patent, "patent_id": patent_id, "publication_year": 2025}
        )
        snapshot["patent-domain-matches"].append(
            {**template_match, "patent_id": patent_id, "total_score": 25 - index}
        )
        snapshot["patent-classifications"].append(
            {"patent_id": patent_id, "cpc_group": "G06N3/04"}
        )
        snapshot["assignee-candidates"].append(
            {
                "assignee_id": f"a-{index:02d}",
                "name": f"示例{index}有限公司",
                "name_normalized": f"示例{index}有限公司",
                "query_key": f"示例{index}有限公司",
                "patent_ids": [patent_id],
                "source_roles": ["current_assignee"],
            }
        )
    assignees = assignee_workset(snapshot, patent_workset(snapshot, plan()))
    assert len(assignees) == 20
    assert assignees[0]["assignee_id"] == "a-00"
    snapshot["companies"] = [
        {
            "company_id": f"candidate-{index}",
            "legal_name": f"候选{index}有限公司",
            "country": "CN",
            "business_info": {},
        }
        for index in range(7)
    ]
    snapshot["company-aliases"] = []
    snapshot["company-search-hits"] = [
        {
            "assignee_id": assignees[0]["assignee_id"],
            "company_id": f"candidate-{index}",
            "provider_rank": index,
        }
        for index in range(7)
    ]
    assert len(resolution_workset(snapshot, assignees[:1])[0]["candidates"]) == 5


@pytest.mark.asyncio
async def test_start_companies_automatically_resolves_and_completes_report():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config: RunnableConfig = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    state = await graph.aget_state(config)
    assert state.next == ()
    result = state.values["result"]
    assert result["patent_count"] == 2
    assert result["companies"][0]["patent_count"] == 2
    assert result["companies"][0]["resolution_kind"] == "agent_inferred"
    assert acquisition.company_targets == [
        {
            "assignee_id": "a1",
            "query_key": "示例科技有限公司",
            "name": "示例科技有限公司",
        },
        {
            "assignee_id": "a2",
            "query_key": "示例科技集团有限公司",
            "name": "示例科技集团有限公司",
        },
    ]
    assert llm.calls == [
        "DirectionProposal",
        "Plan",
        "SubjectResolutionBatch",
        "Analysis",
    ]
    subject_payload = llm.payloads[2]["subjects"][0]
    assert "patent_count" not in subject_payload
    assert "provider_rank" not in subject_payload["candidates"][0]
    assert "credit_code" not in subject_payload["candidates"][0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_resolution",
    ["unknown_assignee", "duplicate", "unknown_company", "invalid_confidence"],
)
async def test_invalid_subject_output_degrades_to_assignee_report(invalid_resolution):
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.invalid_resolution = invalid_resolution
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["companies"] == []
    assert len(result["unresolved_subjects"]) == 2
    assert result["patent_count"] == 2
    assert result["warnings"] == ["企业主体解析失败，报告已降级为专利权利人结果。"]


@pytest.mark.asyncio
async def test_analysis_failure_keeps_mapping_patents_and_statistics():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.fail = "Analysis"
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["companies"][0]["patent_count"] == 2
    assert result["companies"][0]["inference"] is None
    assert result["warnings"] == ["企业技术解释生成失败，已保留映射、专利和统计结果。"]


@pytest.mark.asyncio
async def test_analysis_cannot_cite_unprovided_patent():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.invalid_analysis = True
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["companies"][0]["patent_count"] == 2
    assert result["companies"][0]["inference"] is None
    assert result["warnings"] == ["企业技术解释生成失败，已保留映射、专利和统计结果。"]


@pytest.mark.asyncio
async def test_no_patents_finishes_empty_without_subject_agent_calls():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.search_plan.directions[0].keywords = ["absent"]
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await graph.ainvoke({"question": "工业视觉"}, config)
    await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["patent_count"] == 0
    assert result["empty_reason"]
    assert acquisition.reads == 1
    assert llm.calls == ["DirectionProposal", "Plan"]


@pytest.mark.asyncio
async def test_search_conditions_use_final_description_and_retry_without_collection():
    acquisition, llm, store = FakeAcquisition(), FakeLLM(), runtime_store()
    saver = InMemorySaver()
    graph = build_graph(llm, store, saver, acquisition)
    config = graph_config()
    await graph.ainvoke({"question": "视觉"}, config)
    edited = plan()
    edited.directions[0].name = "边缘视觉"
    edited.directions[0].explanation = "仅关注边缘设备神经网络视觉处理"
    llm.fail = "Plan"
    with pytest.raises(ResearchError):
        await graph.ainvoke(Command(resume={"plan": edited.model_dump()}), config)
    assert (await graph.aget_state(config)).next == ("search_planner",)
    assert acquisition.reads == 0
    llm.fail = None
    await build_graph(llm, store, saver, acquisition).ainvoke(None, config)
    assert (await graph.aget_state(config)).next == ("company_gate",)
    assert acquisition.reads == 1


@pytest.mark.asyncio
async def test_workspace_discussion_preserves_plans_without_acquisition():
    from tech_scout_intelligence.models import ConversationReply

    store, acquisition = runtime_store(), FakeAcquisition()
    original = plan().model_dump()
    llm = AsyncMock()
    llm.generate.return_value = ConversationReply(intent="discuss", reply="这是含义。")
    graph = build_graph(llm, store, InMemorySaver(), acquisition)
    result = await graph.ainvoke(
        {
            "question": "解释方向",
            "conversation": {
                "workspace": True,
                "candidatePlan": original,
                "selectedPlan": original,
            },
        },
        graph_config(),
    )
    assert result["candidate_plan"] == original
    assert result["proposal_plan"] is None
    assert acquisition.reads == 0


def test_workspace_refresh_and_partial_proposal_preserve_selected_directions():
    from tech_scout_intelligence.models import ConversationReply

    original = plan().model_dump()
    other = {**original["directions"][0], "domain_id": "other", "name": "其它方向"}
    original["directions"].append(other)
    conversation = {
        "candidatePlan": copy.deepcopy(original),
        "selectedPlan": copy.deepcopy(original),
    }
    refreshed = conversation_update(
        ConversationReply(
            intent="refresh_candidates",
            reply="新候选",
            updates=[{"domain_id": "new", "name": "新方向", "explanation": "推荐"}],
        ),
        conversation,
    )
    assert refreshed["candidate_plan"]["directions"][0]["domain_id"] == "new"
    proposal = conversation_update(
        ConversationReply(
            intent="propose_selected",
            reply="请应用修改",
            updates=[
                {
                    "domain_id": "vision",
                    "name": "更新视觉",
                    "explanation": "仅修改此项",
                }
            ],
        ),
        conversation,
    )
    assert proposal["proposal_plan"]["directions"][1] == other
    assert conversation["selectedPlan"] == original


@pytest.mark.asyncio
async def test_search_planner_preserves_user_depth_and_partial_progress():
    class PartialAcquisition(FakeAcquisition):
        async def collect(
            self,
            run_id,
            confirmed_plan,
            progress,
            after=0,
            phase="patents",
            company_targets=None,
        ):
            assert confirmed_plan["pages_per_keyword"] == 10
            await progress(
                {
                    "status": "awaiting_companies",
                    "stage": "patents",
                    "completed": 2,
                    "total": 3,
                    "searchFailed": 1,
                    "detailFailed": 1,
                }
            )
            return await super().collect(
                run_id, confirmed_plan, progress, after, phase, company_targets
            )

    graph = build_graph(
        FakeLLM(), runtime_store(), InMemorySaver(), PartialAcquisition()
    )
    config: RunnableConfig = graph_config()
    await graph.ainvoke({"question": "工业视觉"}, config)
    confirmed = plan().model_dump()
    confirmed["pages_per_keyword"] = 10
    await graph.ainvoke(Command(resume={"plan": confirmed}), config)
    state = await graph.aget_state(config)
    assert state.next == ("company_gate",)
    assert state.values["confirmed_plan"]["pages_per_keyword"] == 10
    assert state.values["acquisition"]["total"] == 3
    assert state.values["acquisition"]["detailFailed"] == 1
    assert state.values["acquisition"]["searchFailed"] == 1
