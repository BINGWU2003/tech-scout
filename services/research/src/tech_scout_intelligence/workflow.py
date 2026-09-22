from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .models import (
    Analysis,
    ConversationReply,
    DirectionProposal,
    Keywords,
    Plan,
    ResearchError,
    SelectedPlan,
    SubjectResolutionBatch,
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
    companies: list[dict]
    assignees: list[dict]
    subjects: list[dict]
    resolutions: list[dict]
    unresolved: list[dict]
    warnings: list[str]
    analysis: dict
    result: dict
    acquisition: dict
    candidate_plan: dict
    proposal_plan: dict | None
    reply: str
    reply_intent: str
    generated_keywords: dict


def identity_name(value):
    return "".join(char for char in value.casefold() if char.isalnum())


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


def resolution_workset(snapshot, assignees, limit=5):
    companies = {company["company_id"]: company for company in snapshot["companies"]}
    aliases: dict[str, list[str]] = {}
    for alias in snapshot["company-aliases"]:
        aliases.setdefault(alias["company_id"], []).append(alias["alias_name"])
    hits: dict[str, list[dict]] = {}
    for hit in snapshot.get("company-search-hits", []):
        hits.setdefault(hit["assignee_id"], []).append(hit)
    workset = []
    for assignee in assignees:
        rows = []
        for hit in hits.get(assignee["assignee_id"], []):
            company = companies.get(hit["company_id"])
            if not company:
                continue
            legal_exact = assignee["name_normalized"] == identity_name(
                company["legal_name"]
            )
            alias_exact = assignee["name_normalized"] in {
                identity_name(name) for name in aliases.get(company["company_id"], [])
            }
            fields = company.get("business_info", {})
            rows.append(
                {
                    "company_id": company["company_id"],
                    "legal_name": company["legal_name"],
                    "aliases": aliases.get(company["company_id"], []),
                    "english_name": company.get("english_name"),
                    "country": company.get("country"),
                    "city": fields.get("所在城市"),
                    "district": fields.get("所在区县"),
                    "registered_address": fields.get("注册地址"),
                    "operating_status": fields.get("经营状态"),
                    "established_at": fields.get("成立日期"),
                    "provider_rank": hit["provider_rank"],
                    "source_sha256": company.get("source_sha256"),
                    "_legal_exact": legal_exact,
                    "_alias_exact": alias_exact,
                }
            )
        rows.sort(
            key=lambda company: (
                not company["_legal_exact"],
                not company["_alias_exact"],
                company["provider_rank"],
                company["company_id"],
            )
        )
        candidates = [
            {
                key: value
                for key, value in company.items()
                if key not in {"_legal_exact", "_alias_exact"}
            }
            for company in rows[:limit]
        ]
        workset.append({**assignee, "candidates": candidates})
    return workset


def apply_resolutions(snapshot, subjects, resolutions):
    subject_by_id = {subject["assignee_id"]: subject for subject in subjects}
    company_by_id = {
        company["company_id"]: company for company in snapshot["companies"]
    }
    resolved: dict[str, dict] = {}
    unresolved = []
    for resolution in resolutions:
        subject = subject_by_id[resolution["assignee_id"]]
        if resolution["status"] == "unresolved":
            unresolved.append({**subject, **resolution})
            continue
        company = company_by_id[resolution["company_id"]]
        item = resolved.setdefault(
            company["company_id"],
            {
                **company,
                "patent_ids": [],
                "assignee_names": [],
                "resolution_reasons": [],
                "confidence": "high",
                "resolution_kind": "agent_inferred",
                "relations": [],
            },
        )
        item["patent_ids"] = sorted(
            set(item["patent_ids"]) | set(subject["patent_ids"])
        )
        item["assignee_names"].append(subject["name"])
        item["resolution_reasons"].append(resolution["reason"])
        item["relations"].append(resolution)
        if resolution["confidence"] == "medium":
            item["confidence"] = "medium"
    for item in resolved.values():
        item["assignee_names"] = sorted(set(item["assignee_names"]))
        item["resolution_reason"] = "；".join(dict.fromkeys(item["resolution_reasons"]))
    return list(resolved.values()), unresolved


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


def rank(companies, patents):
    by_id = {p["patent_id"]: p for p in patents}
    result = []
    for company in companies:
        rows = [by_id[pid] for pid in set(company["patent_ids"]) if pid in by_id]
        if not rows:
            continue
        trend: dict[str, int] = {}
        for row in rows:
            year = str(row.get("publication_year") or row.get("grant_year"))
            trend[year] = trend.get(year, 0) + 1
        result.append(
            {
                **company,
                "patent_ids": sorted(p["patent_id"] for p in rows),
                "patent_count": len(rows),
                "grant_year_trend": trend,
                "rule_score": max(m["total_score"] for p in rows for m in p["matches"]),
                "latest_grant_year": max(
                    p.get("publication_year") or p.get("grant_year") or 0 for p in rows
                ),
            }
        )
    return sorted(
        result,
        key=lambda c: (
            -c["rule_score"],
            -c["patent_count"],
            -c["latest_grant_year"],
            c["company_id"],
        ),
    )[:10]


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
        return {"subjects": resolution_workset(state["snapshot"], state["assignees"])}

    async def entity(state, config):
        if not state["subjects"]:
            return {
                "companies": [],
                "resolutions": [],
                "unresolved": [],
                "warnings": [],
            }
        run_id, lease = identity(config)
        payload = {
            "subjects": [
                {
                    "assignee_id": subject["assignee_id"],
                    "name": subject["name"],
                    "candidates": [
                        {
                            key: candidate.get(key)
                            for key in (
                                "company_id",
                                "legal_name",
                                "aliases",
                                "english_name",
                                "country",
                                "city",
                                "district",
                                "registered_address",
                                "operating_status",
                                "established_at",
                                "source_sha256",
                            )
                        }
                        for candidate in subject["candidates"]
                    ],
                }
                for subject in state["subjects"]
            ],
        }
        try:
            generated = await llm.generate(
                run_id,
                lease,
                "逐个解析专利权利人可能对应的企业。只能选择提供的候选企业；"
                "名称、别名、英文名、注册地址等可以作为依据，统一社会信用代码不能"
                "证明专利归属。证据不足或存在多个合理候选时必须 unresolved。",
                payload,
                SubjectResolutionBatch,
            )
            resolutions = [item.model_dump() for item in generated.resolutions]
            expected = {subject["assignee_id"] for subject in state["subjects"]}
            actual = [item["assignee_id"] for item in resolutions]
            if len(actual) != len(set(actual)) or set(actual) != expected:
                raise ResearchError("MODEL_OUTPUT_INVALID", "模型改变了权利人集合")
            allowed = {
                subject["assignee_id"]: {
                    company["company_id"] for company in subject["candidates"]
                }
                for subject in state["subjects"]
            }
            if any(
                item["status"] == "matched"
                and item["company_id"] not in allowed[item["assignee_id"]]
                for item in resolutions
            ):
                raise ResearchError("MODEL_OUTPUT_INVALID", "模型选择了未提供的企业")
            companies, unresolved = apply_resolutions(
                state["snapshot"], state["subjects"], resolutions
            )
            return {
                "companies": companies,
                "resolutions": resolutions,
                "unresolved": unresolved,
                "warnings": [],
            }
        except ResearchError:
            resolutions = [
                {
                    "assignee_id": subject["assignee_id"],
                    "status": "unresolved",
                    "company_id": None,
                    "confidence": None,
                    "reason": "主体解析暂不可用，已保留专利权利人事实",
                }
                for subject in state["subjects"]
            ]
            _, unresolved = apply_resolutions(
                state["snapshot"], state["subjects"], resolutions
            )
            return {
                "companies": [],
                "resolutions": resolutions,
                "unresolved": unresolved,
                "warnings": ["企业主体解析失败，报告已降级为专利权利人结果。"],
            }

    async def analyze(state, config):
        ranked = rank(state["companies"], state["patents"])
        if not ranked:
            return {"analysis": {"companies": []}}
        run_id, lease = identity(config)
        samples = {p["patent_id"]: p for p in state["patents"]}
        payload = {
            "question": state["question"],
            "companies": [
                {
                    "company_id": c["company_id"],
                    "name": c["preferred_name"],
                    "patent_count": c["patent_count"],
                    "rule_score": c["rule_score"],
                    "patents": [
                        {
                            "patent_id": pid,
                            "title": samples[pid]["patent_title"],
                            "abstract": samples[pid].get("abstract"),
                            "cpcs": samples[pid]["cpcs"],
                            "matches": samples[pid]["matches"],
                        }
                        for pid in c["patent_ids"][:5]
                    ],
                }
                for c in ranked
            ],
        }
        try:
            analysis = await llm.generate(
                run_id,
                lease,
                "逐家解释技术相关性，不修改公司集合或程序排序。"
                "每家解释引用所提供专利 ID。"
                "依据给出的标题、摘要（如果有）与 IPC 解释相关性，不声称产品、客户、"
                "市场份额或投资价值。",
                payload,
                Analysis,
            )
            allowed = {
                company["company_id"]: {
                    patent["patent_id"] for patent in company["patents"]
                }
                for company in payload["companies"]
            }
            ids = [company.company_id for company in analysis.companies]
            if len(set(ids)) != len(ids) or set(ids) != set(allowed):
                raise ResearchError("MODEL_CITATION_INVALID", "模型改变了候选公司集合")
            for explanation in analysis.companies:
                if not set(explanation.patent_ids) <= allowed[explanation.company_id]:
                    raise ResearchError(
                        "MODEL_CITATION_INVALID", "模型引用不属于该公司证据"
                    )
            return {"analysis": analysis.model_dump()}
        except ResearchError:
            return {
                "analysis": {"companies": []},
                "warnings": [
                    *state.get("warnings", []),
                    "企业技术解释生成失败，已保留映射、专利和统计结果。",
                ],
            }

    async def finish(state, config):
        ranked = rank(state.get("companies", []), state["patents"])
        explanations = {
            c["company_id"]: c for c in state.get("analysis", {}).get("companies", [])
        }
        for item in ranked:
            item["inference"] = explanations.get(item["company_id"])
            item["ranking_reason"] = (
                "规则相关性、去重公开记录数量、最近公开年份；同值按公司 ID"
            )
        return {
            "result": {
                "companies": ranked,
                "unresolved_subjects": state.get("unresolved", []),
                "warnings": state.get("warnings", []),
                "patent_count": len(state["patents"]),
                "release_id": state["snapshot"]["release"]["release_id"],
                "missing": ["完整法律状态", "产品与客户", "新闻与论文"],
                "empty_reason": "没有符合条件的专利；可修改并确认新计划"
                if not state["patents"]
                else None,
                "workflow_version": "browser-v2",
                "prompt_version": "browser-v2",
            }
        }

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
        "entity": entity,
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
