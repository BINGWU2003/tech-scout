import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from tech_scout_intelligence.models import (
    CompanyAssessment,
    CompanyAssessmentBatch,
    DirectionProposal,
    PatentAssessment,
    PatentAssessmentBatch,
    Keywords,
    Plan,
    ResearchError,
)
from tech_scout_intelligence.workflow import (
    company_lead_workset,
    assignee_workset,
    build_graph,
    conversation_update,
    patent_workset,
)


def runtime_store():
    store = AsyncMock()
    store.get.return_value = SimpleNamespace(artifacts={})

    async def publish(*args, artifacts=None, **kwargs):
        if artifacts is not None:
            store.get.return_value.artifacts = artifacts

    store.publish.side_effect = publish
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
        self.invalid_analysis = False
        self.fail_patent_batch_once = False
        self.fail_company_batch_once = False

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
                        "keywords": d.keywords,
                    }
                    for d in plan().directions
                ],
            )
        if schema is Plan:
            return self.search_plan.model_copy(deep=True)
        if schema is PatentAssessmentBatch:
            if self.fail_patent_batch_once and self.calls.count("PatentAssessmentBatch") == 2:
                self.fail_patent_batch_once = False
                raise ResearchError("MODEL_REQUEST_FAILED", "模型暂时不可用")
            return PatentAssessmentBatch(patents=[
                PatentAssessment(patent_id=p["patent_id"], priority="high", reason="与研究方向相关")
                for p in payload["patents"]
            ])
        if schema is CompanyAssessmentBatch:
            if self.fail_company_batch_once and self.calls.count("CompanyAssessmentBatch") == 2:
                self.fail_company_batch_once = False
                raise ResearchError("MODEL_REQUEST_FAILED", "企业分析暂时不可用")
            return CompanyAssessmentBatch(companies=[
                CompanyAssessment(
                    company_id=c["company_id"], priority="high", summary="值得进一步技术调研",
                    patent_ids=["not-provided"] if self.invalid_analysis else
                    list(dict.fromkeys(lead["patent_id"] for lead in c["leads"]))[:20],
                ) for c in payload["companies"]
            ])
        raise AssertionError(schema)


def graph_config() -> RunnableConfig:
    return {"configurable": {"thread_id": str(uuid4()), "lease": uuid4()}}


async def run_to_company_gate(graph, config):
    await graph.ainvoke({"question": "工业视觉"}, config)
    assert (await graph.aget_state(config)).next == ("plan_gate",)
    await graph.ainvoke(Command(resume={"plan": plan().model_dump()}), config)
    assert (await graph.aget_state(config)).next == ("company_gate",)


def test_multiple_search_hits_remain_independent_leads():
    snapshot = sample()
    patents = patent_workset(snapshot, plan())
    assignees = assignee_workset(snapshot, patents)
    leads = company_lead_workset(snapshot, assignees, patents)
    assert {c["company_id"] for c in leads} == {"c1", "c2"}
    assert {r["patent_id"] for r in leads[0]["relations"]} == {"p1", "p2"}
    assert all(r["basis"] in {"legal_name", "alias", "search_hit"} for c in leads for r in c["relations"])


@pytest.mark.asyncio
async def test_start_companies_assesses_all_patents_and_companies():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["patent_count"] == 2
    assert len(result["patents"]) == 2
    assert {c["company_id"] for c in result["companies"]} == {"c1", "c2"}
    assert all("resolution_kind" not in c for c in result["companies"])
    assert llm.calls == ["DirectionProposal", "Plan", "PatentAssessmentBatch", "CompanyAssessmentBatch"]
    assert len(acquisition.company_targets) == 2


@pytest.mark.asyncio
async def test_invalid_company_citation_prevents_report():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.invalid_analysis = True
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    with pytest.raises(ResearchError, match="模型引用不属于企业查询线索"):
        await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    assert (await graph.aget_state(config)).values.get("result") is None


@pytest.mark.asyncio
async def test_completed_patent_batch_is_reused_after_retry():
    acquisition, llm, store = FakeAcquisition(), FakeLLM(), runtime_store()
    data = acquisition.data
    template = data["patents"][0]
    for index in range(3, 22):
        patent_id = f"p{index}"
        data["patents"].append({**template, "patent_id": patent_id})
        data["patent-classifications"].append({"patent_id": patent_id, "cpc_group": "G06N3/04"})
        data["patent-domain-matches"].append({
            "patent_id": patent_id, "domain_id": "vision", "total_score": 8,
            "evaluation_id": f"e{index}",
        })
        data["assignee-candidates"][0]["patent_ids"].append(patent_id)
    llm.fail_patent_batch_once = True
    graph = build_graph(llm, store, InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    with pytest.raises(ResearchError, match="模型暂时不可用"):
        await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    assert len(store.get.return_value.artifacts["patent_assessments"]) == 20
    await graph.ainvoke(None, config)
    assert (await graph.aget_state(config)).values["result"]["patent_count"] == 21
    assert llm.calls.count("PatentAssessmentBatch") == 3


@pytest.mark.asyncio
async def test_no_company_results_still_produces_patent_report():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    acquisition.data["companies"] = []
    acquisition.data["company-aliases"] = []
    acquisition.data["company-search-hits"] = []
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    result = (await graph.aget_state(config)).values["result"]
    assert result["companies"] == []
    assert len(result["patents"]) == 2
    assert "CompanyAssessmentBatch" not in llm.calls


@pytest.mark.asyncio
async def test_completed_company_batch_is_reused_after_retry():
    acquisition, llm, store = FakeAcquisition(), FakeLLM(), runtime_store()
    for index in range(3, 12):
        company_id = f"c{index}"
        acquisition.data["companies"].append({
            **acquisition.data["companies"][0],
            "company_id": company_id,
            "preferred_name": f"企业{index}",
            "legal_name": f"企业{index}",
        })
        acquisition.data["company-search-hits"].append({
            "assignee_id": "a1", "query_name": "示例科技有限公司",
            "company_id": company_id, "provider_rank": index,
        })
    llm.fail_company_batch_once = True
    graph = build_graph(llm, store, InMemorySaver(), acquisition)
    config = graph_config()
    await run_to_company_gate(graph, config)
    with pytest.raises(ResearchError, match="企业分析暂时不可用"):
        await graph.ainvoke(Command(resume={"kind": "start_companies"}), config)
    assert len(store.get.return_value.artifacts["company_assessments"]) == 10
    await graph.ainvoke(None, config)
    assert len((await graph.aget_state(config)).values["result"]["companies"]) == 11
    assert llm.calls.count("CompanyAssessmentBatch") == 3


@pytest.mark.asyncio
async def test_no_patents_finishes_empty_without_report_agent_calls():
    acquisition, llm = FakeAcquisition(), FakeLLM()
    llm.search_plan.directions[0].keywords = ["absent"]
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await graph.ainvoke({"question": "工业视觉"}, config)
    await graph.ainvoke(Command(resume={"plan": llm.search_plan.model_dump()}), config)
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
            updates=[
                {
                    "domain_id": "new",
                    "name": "新方向",
                    "explanation": "推荐",
                    "keywords": ["新方向"],
                }
            ],
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
    assert (
        proposal["proposal_plan"]["directions"][0]["keywords"]
        == original["directions"][0]["keywords"]
    )
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
            assert confirmed_plan["directions"][0]["keywords"] == [
                "vision",
                "用户编辑词",
            ]
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
    confirmed["directions"][0]["keywords"] = ["vision", "用户编辑词"]
    await graph.ainvoke(Command(resume={"plan": confirmed}), config)
    state = await graph.aget_state(config)
    assert state.next == ("company_gate",)
    assert state.values["confirmed_plan"]["pages_per_keyword"] == 10
    assert state.values["acquisition"]["total"] == 3
    assert state.values["acquisition"]["detailFailed"] == 1
    assert state.values["acquisition"]["searchFailed"] == 1


@pytest.mark.asyncio
async def test_empty_keywords_cannot_start_collection():
    acquisition = FakeAcquisition()
    graph = build_graph(FakeLLM(), runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    await graph.ainvoke({"question": "工业视觉"}, config)
    confirmed = plan().model_dump()
    confirmed["directions"][0]["keywords"] = []
    with pytest.raises(ResearchError, match="至少需要一个检索关键词"):
        await graph.ainvoke(Command(resume={"plan": confirmed}), config)
    assert acquisition.reads == 0


@pytest.mark.asyncio
async def test_keyword_generation_is_a_draft_and_preserves_candidates():
    acquisition, llm = FakeAcquisition(), AsyncMock()
    llm.generate.return_value = Keywords(keywords=["工业视觉", "机器视觉", "工业视觉"])
    original = plan().model_dump()
    graph = build_graph(llm, runtime_store(), InMemorySaver(), acquisition)
    config = graph_config()
    result = await graph.ainvoke(
        {
            "question": "生成检索关键词",
            "conversation": {
                "workspace": True,
                "keywordDirection": {
                    "domain_id": "manual",
                    "name": "工业视觉",
                    "explanation": "缺陷检测",
                },
                "candidatePlan": original,
                "selectedPlan": original,
            },
        },
        config,
    )
    assert result["generated_keywords"]["keywords"] == ["工业视觉", "机器视觉"]
    assert result["candidate_plan"] == original
    assert (await graph.aget_state(config)).next == ("plan_gate",)
    assert "confirmed_plan" not in result
    assert acquisition.reads == 0
