import unicodedata
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .models import (
    CompanyAssessmentBatch,
    ConversationReply,
    DirectionProposal,
    Keywords,
    Plan,
    PatentAssessmentBatch,
    ResearchError,
    SelectedPlan,
)
from .prompts import CONVERSATION_PROMPT, DIRECTION_PROMPT
from .store import validate_plan


class State(TypedDict, total=False):
    question: str
    conversation: dict
    context: dict
    plan: dict
    confirmed_plan: dict
    snapshot: dict
    patents: list[dict]
    company_leads: list[dict]
    assignees: list[dict]
    patent_assessments: list[dict]
    company_assessments: list[dict]
    result: dict
    acquisition: dict
    candidate_plan: dict
    proposal_plan: dict | None
    reply: str
    reply_intent: str
    generated_keywords: dict


def identity_name(value):
    return "".join(
        char for char in unicodedata.normalize("NFKC", value).casefold()
        if char.isalnum()
    )


def conversation_update(response, conversation):
    """Apply a bounded patch; discussion never changes a plan."""
    candidates = conversation.get("candidatePlan")
    result = {
        "candidate_plan": candidates,
        "reply": response.reply,
        "reply_intent": response.intent,
        "proposal_plan": None,
    }
    if response.intent == "discuss":
        return result
    selected = response.intent == "propose_selected"
    base = conversation.get("selectedPlan") if selected else candidates
    if not base and response.intent == "refresh_candidates":
        base = conversation.get("selectedPlan")
    if not base:
        raise ResearchError(
            "MODEL_OUTPUT_INVALID", "没有可修改的计划，请先生成候选方向"
        )
    plan = SelectedPlan.model_validate(base).model_copy(deep=True)
    updates = response.updates
    ids = [d.domain_id for d in updates]
    if len(ids) != len(set(ids)):
        raise ResearchError("MODEL_OUTPUT_INVALID", "修改建议包含重复方向")
    if response.intent == "refresh_candidates":
        if not updates or response.remove_ids:
            raise ResearchError("MODEL_OUTPUT_INVALID", "刷新候选需要完整候选方向")
        directions = [d.model_dump() for d in updates]
    else:
        known = {d.domain_id for d in plan.directions}
        if (set(ids) | set(response.remove_ids)) - known or set(ids) & set(
            response.remove_ids
        ):
            raise ResearchError(
                "MODEL_OUTPUT_INVALID", "修改建议引用了不存在或冲突的方向"
            )
        patches = {d.domain_id: d.model_dump() for d in updates}
        directions = [
            {
                **d.model_dump(),
                **patches.get(d.domain_id, {}),
                **({"keywords": d.keywords} if selected else {}),
            }
            for d in plan.directions
            if d.domain_id not in response.remove_ids
        ]
    data = {**plan.model_dump(), "directions": directions}
    if response.from_year is not None:
        data["from_year"] = response.from_year
    if response.to_year is not None:
        data["to_year"] = response.to_year
    changed = SelectedPlan.model_validate(data).model_dump()
    result["proposal_plan" if selected else "candidate_plan"] = changed
    return result


def patent_workset(snapshot, plan):
    classifications: dict[str, list] = {}
    matches: dict[str, list] = {}
    for row in snapshot["patent-classifications"]:
        classifications.setdefault(row["patent_id"], []).append(row["cpc_group"])
    for row in snapshot["patent-domain-matches"]:
        matches.setdefault(row["patent_id"], []).append(row)
    found = []
    for patent in snapshot["patents"]:
        year = patent.get("publication_year")
        if year is None or not plan.from_year <= year <= plan.to_year:
            continue
        title = patent["patent_title"].casefold()
        title += " " + " ".join(
            str(patent.get(field) or "").casefold()
            for field in ("abstract", "claims", "description")
        )
        cpcs = classifications.get(patent["patent_id"], [])
        reasons = []
        for direction in plan.directions:
            relevant = [
                m
                for m in matches.get(patent["patent_id"], [])
                if m["domain_id"] == direction.domain_id
            ]
            if not relevant or any(
                word.casefold() in title for word in direction.excluded_keywords
            ):
                continue
            if direction.keywords and not any(
                word.casefold() in title for word in direction.keywords
            ):
                continue
            if direction.cpc_prefixes and not any(
                cpc.upper().startswith(prefix.upper())
                for prefix in direction.cpc_prefixes
                for cpc in cpcs
            ):
                continue
            reasons.extend(relevant)
        if reasons:
            found.append({**patent, "matches": reasons, "cpcs": cpcs})
    return sorted(found, key=lambda p: p["patent_id"])


def assignee_workset(snapshot, patents, limit=20):
    patent_by_id = {patent["patent_id"]: patent for patent in patents}
    result = []
    for candidate in snapshot.get("assignee-candidates", []):
        patent_ids = sorted(set(candidate["patent_ids"]) & set(patent_by_id))
        if not patent_ids:
            continue
        rows = [patent_by_id[patent_id] for patent_id in patent_ids]
        result.append(
            {
                **candidate,
                "patent_ids": patent_ids,
                "patent_count": len(patent_ids),
                "rule_score": max(
                    match["total_score"]
                    for patent in rows
                    for match in patent["matches"]
                ),
                "latest_year": max(
                    patent.get("publication_year") or patent.get("grant_year") or 0
                    for patent in rows
                ),
            }
        )
    return sorted(
        result,
        key=lambda item: (
            -item["rule_score"],
            -item["patent_count"],
            -item["latest_year"],
            item["assignee_id"],
        ),
    )[:limit]


def scoped_snapshot(snapshot, plan):
    """Retain the scoped patent facts and independent company observations."""
    patents = patent_workset(snapshot, plan)
    patent_ids = {p["patent_id"] for p in patents}
    result = dict(snapshot)
    result["patents"] = [p for p in snapshot["patents"] if p["patent_id"] in patent_ids]
    for table in (
        "patent-classifications",
        "patent-parties",
        "patent-domain-matches",
    ):
        result[table] = [r for r in snapshot[table] if r["patent_id"] in patent_ids]
    result["assignee-candidates"] = [
        {**candidate, "patent_ids": sorted(set(candidate["patent_ids"]) & patent_ids)}
        for candidate in snapshot.get("assignee-candidates", [])
        if set(candidate["patent_ids"]) & patent_ids
    ]
    assignee_ids = {
        candidate["assignee_id"] for candidate in result["assignee-candidates"]
    }
    result["company-search-hits"] = [
        hit
        for hit in snapshot.get("company-search-hits", [])
        if hit["assignee_id"] in assignee_ids
    ]
    company_ids = {hit["company_id"] for hit in result["company-search-hits"]}
    for table in ("companies", "company-aliases", "external-identifiers"):
        result[table] = [r for r in snapshot[table] if r["company_id"] in company_ids]
    evaluation_ids = {r.get("evaluation_id") for r in result["patent-domain-matches"]}
    result["evaluations"] = [
        r
        for r in snapshot.get("evaluations", [])
        if r["evaluation_id"] in evaluation_ids
    ]
    return result


def company_lead_workset(snapshot, assignees, patents):
    """Search observations remain leads, including ambiguous multi-company hits."""
    patent_ids = {patent["patent_id"] for patent in patents}
    assignee_by_id = {item["assignee_id"]: item for item in assignees}
    aliases: dict[str, set[str]] = {}
    for row in snapshot["company-aliases"]:
        aliases.setdefault(row["company_id"], set()).add(identity_name(row["alias_name"]))
    hits: dict[str, list[dict]] = {}
    for hit in snapshot["company-search-hits"]:
        if hit["assignee_id"] in assignee_by_id:
            hits.setdefault(hit["company_id"], []).append(hit)
    result = []
    for company in snapshot["companies"]:
        relations = []
        for hit in hits.get(company["company_id"], []):
            assignee = assignee_by_id[hit["assignee_id"]]
            name = identity_name(assignee["name"])
            basis = (
                "legal_name"
                if name == identity_name(company["legal_name"])
                else "alias"
                if name in aliases.get(company["company_id"], set())
                else "search_hit"
            )
            for patent_id in sorted(set(assignee["patent_ids"]) & patent_ids):
                relations.append({
                    "patent_id": patent_id,
                    "assignee_id": assignee["assignee_id"],
                    "assignee_name": assignee["name"],
                    "basis": basis,
                })
        result.append({**company, "relations": relations})
    return result


def build_graph(llm, store, checkpointer, acquisition):
    async def context(state, config):
        return {"context": await acquisition.context()}

    async def planner(state, config):
        run_id, lease = identity(config)
        conversation = state.get("conversation", {})
        if conversation.get("keywordDirection"):
            generated = await llm.generate(
                run_id,
                lease,
                "为给定技术方向生成 1–12 个专利检索关键词，默认中文，允许必要英文术语。"
                "每项不超过 200 字符，避免重复和过窄条件。",
                {"direction": conversation["keywordDirection"]},
                Keywords,
            )
            return {
                "generated_keywords": {
                    "keywords": list(dict.fromkeys(generated.keywords))
                },
                "candidate_plan": conversation.get("candidatePlan"),
                "reply": "关键词已生成，请在方向卡片中检查并保存。",
                "reply_intent": "discuss",
            }
        if conversation.get("startSearch"):
            plan = Plan.model_validate(conversation["selectedPlan"])
            validate_plan(plan, state["context"])
            return {
                "plan": plan.model_dump(),
                "confirmed_plan": plan.model_dump(),
                "candidate_plan": conversation.get("candidatePlan"),
                "reply": "已确认已选研究计划，开始检索。",
            }
        if conversation.get("workspace"):
            response = await llm.generate(
                run_id,
                lease,
                CONVERSATION_PROMPT,
                {
                    "question": state["question"],
                    "conversation": conversation,
                    "context": state["context"],
                },
                ConversationReply,
            )
            update = conversation_update(response, conversation)
            for key in ("candidate_plan", "proposal_plan"):
                value = update.get(key)
                if value and (
                    value["to_year"] > state["context"]["period_to_year"]
                    or value["from_year"]
                    < state["context"].get("period_from_year", 1800)
                ):
                    raise ResearchError(
                        "MODEL_OUTPUT_INVALID", "建议年份超出可检索范围"
                    )
            candidate = update.get("candidate_plan")
            return {
                **update,
                "plan": candidate if candidate and candidate["directions"] else None,
            }

        async def explain(message, direction=None):
            current = await store.get(run_id)
            await store.publish(
                run_id,
                lease=lease,
                kind="planner_progress",
                artifacts={
                    **current.artifacts,
                    "process": {
                        "stage": "planner",
                        "message": message,
                        "direction": direction,
                        "outcome": "completed" if direction else "running",
                    },
                },
            )

        await explain("正在结合研究需求与历史条件，生成技术方向与范围描述。")
        proposal = await llm.generate(
            run_id,
            lease,
            DIRECTION_PROMPT,
            {
                "question": state["question"],
                "context": state["context"],
                "conversation": state.get("conversation", {}),
            },
            DirectionProposal,
        )
        plan = Plan(
            directions=proposal.model_dump()["directions"],
            from_year=state["context"].get("period_from_year", 1800),
            to_year=state["context"]["period_to_year"],
        )
        validate_plan(plan, state["context"])
        for direction in plan.directions:
            await explain(direction.explanation, direction.name)
        return {
            "plan": plan.model_dump(),
            "reply": proposal.reply,
            "reply_intent": "refresh_candidates",
        }

    async def plan_gate(state, config):
        confirmed = state.get("confirmed_plan")
        if confirmed is None:
            payload = interrupt({"kind": "plan", "plan": state.get("plan")})
            confirmed = payload["plan"]
        plan = Plan.model_validate(confirmed)
        validate_plan(plan, state["context"])
        for direction in plan.directions:
            if not direction.keywords:
                raise ResearchError("INVALID_PLAN", "每个方向至少需要一个检索关键词")
            direction.excluded_keywords = []
            direction.cpc_prefixes = []
        plan.risks = []
        return {"confirmed_plan": plan.model_dump()}

    async def search_planner(state, config):
        run_id, lease = identity(config)
        confirmed = Plan.model_validate(state["confirmed_plan"])
        directions = [
            {
                "domain_id": d.domain_id,
                "name": d.name,
                "explanation": d.explanation,
                "keywords": d.keywords,
            }
            for d in confirmed.directions
        ]
        current = await store.get(run_id)
        await store.publish(
            run_id,
            lease=lease,
            kind="search_progress",
            artifacts={
                **current.artifacts,
                "process": {
                    "stage": "patents",
                    "message": "正在根据已确认方向与描述生成检索条件。",
                    "outcome": "running",
                },
            },
        )
        generated = await llm.generate(
            run_id,
            lease,
            "根据用户最终确认的 directions 生成 Google Patents 检索条件。"
            "保持方向 domain_id、名称和描述不变，不增删方向。"
            "保留用户确认的 keywords 原值，只生成排除词、IPC 和公开年份。"
            "关键词组内 OR，关键词与 IPC 条件 AND，方向间 OR，避免过窄条件。"
            "年份不得超出 context 范围，不能表达的限制记录在 risks。",
            {
                "directions": directions,
                "question": state["question"],
                "conversation": state.get("conversation", {}),
                "context": state["context"],
            },
            Plan,
        )
        if [d.domain_id for d in generated.directions] != [
            d.domain_id for d in confirmed.directions
        ]:
            raise ResearchError(
                "MODEL_PLAN_INVALID", "检索条件改变了已确认方向，请重试"
            )
        for output, original in zip(
            generated.directions, confirmed.directions, strict=True
        ):
            output.name = original.name
            output.explanation = original.explanation
            output.keywords = original.keywords
        validate_plan(generated, state["context"])
        generated.pages_per_keyword = confirmed.pages_per_keyword
        for direction in generated.directions:
            direction.keywords = list(dict.fromkeys(direction.keywords))
        return {"confirmed_plan": generated.model_dump()}

    async def collect_snapshot(state, config, phase, company_targets=None):
        run_id, lease = identity(config)
        acquisition_view = {}

        async def progress(value):
            current = await store.get(run_id)
            if "process" in value:
                await store.publish(
                    run_id,
                    lease=lease,
                    kind="search_progress",
                    artifacts={**current.artifacts, **value},
                )
                return
            acquisition_view.update(value)
            await store.publish(
                run_id,
                lease=lease,
                kind="acquisition_progress",
                artifacts={**current.artifacts, "acquisition": value},
            )

        current = await store.get(run_id)
        data = await acquisition.collect(
            run_id,
            state["confirmed_plan"],
            progress,
            after=current.artifacts.get("acquisition_cursor", 0),
            phase=phase,
            company_targets=company_targets,
        )
        return {
            "snapshot": scoped_snapshot(
                data, Plan.model_validate(state["confirmed_plan"])
            ),
            "acquisition": {
                **acquisition_view,
                "status": "completed",
                "stage": "patents" if phase == "patents" else "companies",
            },
        }

    async def snapshot(state, config):
        return await collect_snapshot(state, config, "patents")

    async def company_gate(state, config):
        interrupt(
            {
                "kind": "companies",
                "patent_count": len(state["patents"]),
                "assignee_count": len(state["assignees"]),
            }
        )
        return {}

    async def company_snapshot(state, config):
        targets = [
            {
                "assignee_id": item["assignee_id"],
                "query_key": item["query_key"],
                "name": item["name"],
            }
            for item in state["assignees"]
        ]
        return await collect_snapshot(state, config, "companies", targets)

    async def patent(state, config):
        return {
            "patents": patent_workset(
                state["snapshot"], Plan.model_validate(state["confirmed_plan"])
            )
        }

    async def assignee(state, config):
        return {"assignees": assignee_workset(state["snapshot"], state["patents"])}

    async def company(state, config):
        return {"company_leads": company_lead_workset(
            state["snapshot"], state["assignees"], state["patents"]
        )}

    async def assess_patents(state, config):
        run_id, lease = identity(config)
        current = await store.get(run_id)
        saved = {item["patent_id"]: item for item in current.artifacts.get("patent_assessments", [])}
        patents = sorted(state["patents"], key=lambda item: item["patent_id"])
        for offset in range(0, len(patents), 20):
            batch = [item for item in patents[offset:offset + 20] if item["patent_id"] not in saved]
            if not batch:
                continue
            payload = {"question": state["question"], "directions": state["confirmed_plan"]["directions"],
                "patents": [{"patent_id": p["patent_id"], "title": p["patent_title"],
                    "abstract": p.get("abstract"), "claims": (p.get("claims") or "")[:2000],
                    "cpcs": p["cpcs"], "matches": p["matches"]} for p in batch]}
            generated = await llm.generate(run_id, lease,
                "逐件评估专利对本次研究问题的技术参考价值。每件都返回 high、medium 或 low 和基于所给专利事实的理由；"
                "不推断法律有效性、技术新颖性、商业收入或企业权属。不得增删专利 ID。",
                payload, PatentAssessmentBatch)
            rows = [item.model_dump() for item in generated.patents]
            ids = [item["patent_id"] for item in rows]
            if len(ids) != len(set(ids)) or set(ids) != {p["patent_id"] for p in batch}:
                raise ResearchError("MODEL_OUTPUT_INVALID", "模型改变了专利集合")
            saved.update((item["patent_id"], item) for item in rows)
            current = await store.get(run_id)
            await store.publish(run_id, lease=lease, kind="analysis_progress",
                artifacts={**current.artifacts, "patent_assessments": list(saved.values())})
        return {"patent_assessments": list(saved.values())}

    async def analyze(state, config):
        run_id, lease = identity(config)
        current = await store.get(run_id)
        saved = {item["company_id"]: item for item in current.artifacts.get("company_assessments", [])}
        assessments = {item["patent_id"]: item for item in state["patent_assessments"]}
        companies = sorted(state["company_leads"], key=lambda item: item["company_id"])
        for offset in range(0, len(companies), 10):
            batch = [item for item in companies[offset:offset + 10] if item["company_id"] not in saved]
            if not batch:
                continue
            payload = {"question": state["question"], "companies": [{
                "company_id": c["company_id"], "name": c["legal_name"],
                "business_info": c["business_info"],
                "leads": [{**relation, "patent_assessment": assessments[relation["patent_id"]]}
                    for relation in c["relations"]],
            } for c in batch]}
            generated = await llm.generate(run_id, lease,
                "逐家评估进一步技术与专利调研的优先级。查询命中只是调研线索，同一权利人可以命中多家企业；"
                "不得声称企业拥有线索专利、不得推断财务或投资价值。每家返回 high、medium 或 low、理由及所给线索中的专利引用；"
                "不得增删企业 ID。", payload, CompanyAssessmentBatch)
            rows = [item.model_dump() for item in generated.companies]
            ids = [item["company_id"] for item in rows]
            allowed = {c["company_id"]: {r["patent_id"] for r in c["relations"]} for c in batch}
            if len(ids) != len(set(ids)) or set(ids) != set(allowed):
                raise ResearchError("MODEL_OUTPUT_INVALID", "模型改变了企业集合")
            if any(not set(item["patent_ids"]) <= allowed[item["company_id"]] for item in rows):
                raise ResearchError("MODEL_CITATION_INVALID", "模型引用不属于企业查询线索")
            saved.update((item["company_id"], item) for item in rows)
            current = await store.get(run_id)
            await store.publish(run_id, lease=lease, kind="analysis_progress",
                artifacts={**current.artifacts, "company_assessments": list(saved.values())})
        return {"company_assessments": list(saved.values())}

    async def finish(state, config):
        patents = {item["patent_id"]: item for item in state.get("patent_assessments", [])}
        companies = {item["company_id"]: item for item in state.get("company_assessments", [])}
        if len(patents) != len(state["patents"]) or len(companies) != len(state.get("company_leads", [])):
            raise ResearchError("ANALYSIS_INCOMPLETE", "报告分析尚未覆盖全部专利和企业")
        priority = {"high": 0, "medium": 1, "low": 2}
        ranked_patents = sorted(patents.values(), key=lambda p: (priority[p["priority"]], p["patent_id"]))
        ranked_companies = sorted(({
            **lead, **companies[lead["company_id"]],
        } for lead in state.get("company_leads", [])), key=lambda c: (
            priority[c["priority"]],
            min((priority[patents[r["patent_id"]]["priority"]] for r in c["relations"]), default=3),
            c["company_id"],
        ))
        return {"result": {
            "companies": ranked_companies, "patents": ranked_patents,
            "patent_count": len(state["patents"]),
            "release_id": state["snapshot"]["release"]["release_id"],
            "missing": ["专利权属核验", "完整法律状态", "产品与客户", "财务与市场信息"],
            "empty_reason": "没有符合条件的专利；可修改并确认新计划" if not state["patents"] else None,
            "workflow_version": "browser-v3", "prompt_version": "browser-v3",
        }}

    builder = StateGraph(State)
    nodes = {
        "context": context,
        "planner": planner,
        "plan_gate": plan_gate,
        "search_planner": search_planner,
        "snapshot": snapshot,
        "patent": patent,
        "assignee": assignee,
        "company_gate": company_gate,
        "company_snapshot": company_snapshot,
        "company": company,
        "assess_patents": assess_patents,
        "analyze": analyze,
        "finish": finish,
    }
    previous = START
    for name, fn in nodes.items():

        async def wrapped(state: State, config: RunnableConfig, name=name, fn=fn):
            run_id, lease = identity(config)
            await store.publish(run_id, lease=lease, kind="node_started", node=name)
            result = await fn(state, config)
            # Validate the lease again before LangGraph commits this node's state.
            await store.heartbeat(run_id, lease, 0)
            return result

        builder.add_node(name, wrapped)
        if previous != "assignee":
            builder.add_edge(previous, name)
        previous = name
    builder.add_conditional_edges(
        "assignee",
        lambda state: "company_gate" if state["patents"] else "finish",
    )
    builder.add_edge(previous, END)
    return builder.compile(checkpointer=checkpointer)


def identity(config):
    return config["configurable"]["thread_id"], config["configurable"]["lease"]
