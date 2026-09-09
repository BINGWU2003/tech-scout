from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .models import Analysis, Plan, ResearchError
from .store import validate_decisions, validate_plan


class State(TypedDict, total=False):
    question: str
    context: dict
    plan: dict
    confirmed_plan: dict
    snapshot: dict
    patents: list[dict]
    companies: list[dict]
    unverified: list[dict]
    decisions: list[dict]
    analysis: dict
    evidence_findings: dict
    result: dict
    acquisition: dict


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


def company_workset(snapshot, patents):
    patent_ids = {p["patent_id"] for p in patents}
    by_company: dict[str, set] = {}
    links: dict[str, list] = {}
    linked_parties = set()
    review_by_id = {d["candidate_id"]: d for d in snapshot["entity-review-decisions"]}
    conflicting = set()
    for relation in snapshot["company-patent-relations"]:
        if relation["patent_id"] in patent_ids:
            review = review_by_id.get(relation["candidate_id"])
            if review and (
                review["decision"] != "accepted"
                or review["selected_company_id"] != relation["company_id"]
            ):
                conflicting.add(relation["candidate_id"])
                continue
            by_company.setdefault(relation["company_id"], set()).add(
                relation["patent_id"]
            )
            links.setdefault(relation["company_id"], []).append(relation)
            linked_parties.add(relation["patent_party_id"])
    companies = [
        {
            **company,
            "patent_ids": sorted(by_company[company["company_id"]]),
            "relations": links[company["company_id"]],
            "identity": "catalog_verified",
        }
        for company in snapshot["companies"]
        if company["company_id"] in by_company
    ]
    candidates = {
        (c["name_normalized"], c["country"]): c for c in snapshot["company-candidates"]
    }
    decisions = {d["candidate_id"]: d for d in snapshot["entity-review-decisions"]}
    unverified: dict[str, dict] = {}
    for party in snapshot["patent-parties"]:
        if (
            party["patent_id"] not in patent_ids
            or party["patent_party_id"] in linked_parties
            or party["party_role"] != "assignee"
        ):
            continue
        candidate = candidates.get((party["party_name_normalized"], party["country"]))
        cid = (
            candidate["candidate_id"]
            if candidate
            else "party:" + party["patent_party_id"]
        )
        decision = decisions.get(cid)
        excluded = bool(
            decision and decision["decision"] not in {"accepted", "unresolved"}
        )
        item = unverified.setdefault(
            cid,
            {
                "candidate_id": cid,
                "name": party["party_name"],
                "country": party["country"],
                "patent_ids": [],
                "party_ids": [],
                "catalog_decision": decision,
                "terminal_exclusion": excluded,
                "requires_confirmation": cid in conflicting or decision is None,
                "status": "not_found"
                if candidate and candidate.get("lookup_status") == "not_found"
                else "unverified",
                "suggestions": [
                    m for m in snapshot["entity-matches"] if m["candidate_id"] == cid
                ],
                "evidence": [
                    e for e in snapshot["entity-evidence"] if e["candidate_id"] == cid
                ],
            },
        )
        item["patent_ids"] = sorted(set(item["patent_ids"]) | {party["patent_id"]})
        item["party_ids"].append(party["patent_party_id"])
    return companies, sorted(unverified.values(), key=lambda c: c["candidate_id"])


def scoped_snapshot(snapshot, plan):
    """Retain actual research facts and their identity/provenance dependencies."""
    patents = patent_workset(snapshot, plan)
    patent_ids = {p["patent_id"] for p in patents}
    result = dict(snapshot)
    result["patents"] = [p for p in snapshot["patents"] if p["patent_id"] in patent_ids]
    for table in (
        "patent-classifications",
        "patent-parties",
        "patent-domain-matches",
        "company-patent-relations",
    ):
        result[table] = [r for r in snapshot[table] if r["patent_id"] in patent_ids]
    names = {
        (p["party_name_normalized"], p["country"]) for p in result["patent-parties"]
    }
    candidate_ids = {r["candidate_id"] for r in result["company-patent-relations"]}
    candidate_ids.update(
        c["candidate_id"]
        for c in snapshot["company-candidates"]
        if (c["name_normalized"], c["country"]) in names
    )
    for table in (
        "company-candidates",
        "entity-matches",
        "entity-review-decisions",
        "entity-evidence",
    ):
        result[table] = [
            r for r in snapshot[table] if r["candidate_id"] in candidate_ids
        ]
    company_ids = {r["company_id"] for r in result["company-patent-relations"]}
    company_ids.update(r.get("suggested_company_id") for r in result["entity-matches"])
    company_ids.update(
        r.get("selected_company_id") for r in result["entity-review-decisions"]
    )
    result["company-relations"] = [
        r
        for r in snapshot["company-relations"]
        if r["start_company_id"] in company_ids or r["end_company_id"] in company_ids
    ]
    for relation in result["company-relations"]:
        company_ids.update((relation["start_company_id"], relation["end_company_id"]))
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


def evidence_findings(snapshot, unverified):
    evidence = {e["evidence_id"]: e for e in snapshot["entity-evidence"]}
    by_candidate: dict[str, list] = {}
    for item in evidence.values():
        by_candidate.setdefault(item["candidate_id"], []).append(item)
    conflicts = []
    for candidate_id, rows in by_candidate.items():
        fields: dict[str, dict[str, list]] = {}
        for row in rows:
            if row.get("identifier_type") and row.get("identifier_value"):
                values = fields.setdefault(row["identifier_type"], {})
                values.setdefault(row["identifier_value"], []).append(
                    row["evidence_id"]
                )
        for identifier_type, values in fields.items():
            if len(values) > 1:
                conflicts.append(
                    {
                        "candidate_id": candidate_id,
                        "kind": "identity_identifier_conflict",
                        "identifier_type": identifier_type,
                        "values": values,
                        "note": "同一候选的来源包含不同标识，需结合观察时间复核",
                    }
                )
    for item in unverified:
        if item.get("requires_confirmation") and item.get("catalog_decision"):
            conflicts.append(
                {
                    "candidate_id": item["candidate_id"],
                    "kind": "relation_review_conflict",
                    "note": "正式关系与审核结论需复核，未静默覆盖",
                }
            )
    return {
        "conflicts": conflicts,
        "identity_evidence": [
            {
                "evidence_id": e["evidence_id"],
                "candidate_id": e["candidate_id"],
                "scope": "identity_only",
                "publisher": e.get("publisher"),
                "observed_at": e.get("observed_at"),
                "preserved": bool(e.get("preserved")),
                "has_content_hash": bool(e.get("content_sha256")),
                "has_source_locator": bool(
                    e.get("source_sha256") and e.get("source_path")
                ),
                "original_text_available": False,
            }
            for e in sorted(evidence.values(), key=lambda e: e["evidence_id"])
        ],
    }


def build_graph(llm, store, checkpointer, acquisition):
    async def context(state, config):
        return {"context": await acquisition.context()}

    async def planner(state, config):
        run_id, lease = identity(config)
        plan = await llm.generate(
            run_id,
            lease,
            (
                "将技术方向拆成 1–3 个万方专利可检索方向。"
                "为每个方向生成唯一 domain_id。"
                "无需已有数据库领域。年份表示公开年份，不能晚于当前年份。"
                "只生成检索方案，不生成公司或专利事实。"
            )
            + "关键词组内 OR，"
            "关键词与 IPC 条件 AND，方向间 OR。优先使用中文标题词；"
            "避免同时设置过窄条件。年份不能超出数据范围。",
            {"question": state["question"], "context": state["context"]},
            Plan,
        )
        validate_plan(plan, state["context"])
        return {"plan": plan.model_dump()}

    async def plan_gate(state, config):
        confirmed = state.get("confirmed_plan")
        if confirmed is None:
            payload = interrupt({"kind": "plan", "plan": state["plan"]})
            confirmed = payload["plan"]
        plan = Plan.model_validate(confirmed)
        validate_plan(plan, state["context"])
        return {"confirmed_plan": plan.model_dump()}

    async def snapshot(state, config):
        run_id, lease = identity(config)

        async def progress(value):
            current = await store.get(run_id)
            await store.publish(
                run_id,
                lease=lease,
                kind="acquisition_progress",
                artifacts={**current.artifacts, "acquisition": value},
            )

        data = await acquisition.collect(run_id, state["confirmed_plan"], progress)
        return {
            "snapshot": scoped_snapshot(
                data, Plan.model_validate(state["confirmed_plan"])
            ),
            "acquisition": {"status": "completed", "stage": "snapshot"},
        }

    async def patent(state, config):
        return {
            "patents": patent_workset(
                state["snapshot"], Plan.model_validate(state["confirmed_plan"])
            )
        }

    async def company(state, config):
        companies, unverified = company_workset(state["snapshot"], state["patents"])
        return {"companies": companies, "unverified": unverified}

    async def entity(state, config):
        pending = [u for u in state["unverified"] if u["requires_confirmation"]]
        if not pending:
            return {"decisions": []}
        payload = interrupt({"kind": "entities", "unverified": pending})
        decisions = payload["decisions"]
        validate_decisions(decisions, state)
        companies = {c["company_id"]: dict(c) for c in state["companies"]}
        originals = {c["company_id"]: c for c in state["snapshot"]["companies"]}
        unverified = {u["candidate_id"]: dict(u) for u in state["unverified"]}
        for decision in decisions:
            item = unverified[decision["candidate_id"]]
            item["user_decision"] = {
                **decision,
                "actor_id": payload["actor_id"],
                "action_id": payload["action_id"],
                "confirmed_at": payload["submitted_at"],
            }
            if decision["action"] == "confirm":
                cid = decision["company_id"]
                target = companies.setdefault(
                    cid,
                    {
                        **originals[cid],
                        "patent_ids": [],
                        "relations": [],
                        "identity": "user_confirmed",
                        "user_evidence": [],
                    },
                )
                target["patent_ids"] = sorted(
                    set(target["patent_ids"]) | set(item["patent_ids"])
                )
                target.setdefault("user_evidence", []).append(item["user_decision"])
                item["status"] = "user_confirmed"
            else:
                item["status"] = (
                    "rejected" if decision["action"] == "reject" else "unverified"
                )
        return {
            "companies": list(companies.values()),
            "unverified": list(unverified.values()),
            "decisions": decisions,
        }

    async def evidence(state, config):
        findings = evidence_findings(state["snapshot"], state["unverified"])
        ranked = rank(state["companies"], state["patents"])
        if not ranked:
            return {"analysis": {"companies": []}, "evidence_findings": findings}
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
        analysis = await llm.generate(
            run_id,
            lease,
            "逐家解释技术相关性，不修改公司集合或程序排序。每家解释引用所提供专利 ID。"
            "依据给出的标题、摘要（如果有）与 IPC 解释相关性，不声称产品、客户、"
            "市场份额或投资价值。",
            payload,
            Analysis,
        )
        allowed = {
            c["company_id"]: {p["patent_id"] for p in c["patents"]}
            for c in payload["companies"]
        }
        ids = [c.company_id for c in analysis.companies]
        if len(set(ids)) != len(ids) or set(ids) != set(allowed):
            raise ResearchError("MODEL_CITATION_INVALID", "模型改变了候选公司集合")
        for explanation in analysis.companies:
            if not set(explanation.patent_ids) <= allowed[explanation.company_id]:
                raise ResearchError(
                    "MODEL_CITATION_INVALID", "模型引用不属于该公司证据"
                )
        return {"analysis": analysis.model_dump(), "evidence_findings": findings}

    async def finish(state, config):
        ranked = rank(state["companies"], state["patents"])
        explanations = {c["company_id"]: c for c in state["analysis"]["companies"]}
        for item in ranked:
            item["inference"] = explanations.get(item["company_id"])
            item["ranking_reason"] = (
                "规则相关性、去重公开记录数量、最近公开年份；同值按公司 ID"
            )
        return {
            "result": {
                "companies": ranked,
                "unverified": [
                    u for u in state["unverified"] if u["status"] != "user_confirmed"
                ],
                "patent_count": len(state["patents"]),
                "release_id": state["snapshot"]["release"]["release_id"],
                "missing": ["完整法律状态", "产品与客户", "新闻与论文"],
                "empty_reason": "没有符合条件的专利或已核验公司；可修改并确认新计划"
                if not ranked
                else None,
                "workflow_version": "browser-v1",
                "prompt_version": "browser-v1",
                "evidence_quality": state["evidence_findings"]["identity_evidence"],
                "conflicts": state["evidence_findings"]["conflicts"],
            }
        }

    builder = StateGraph(State)
    nodes = {
        "context": context,
        "planner": planner,
        "plan_gate": plan_gate,
        "snapshot": snapshot,
        "patent": patent,
        "company": company,
        "entity": entity,
        "evidence": evidence,
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
        builder.add_edge(previous, name)
        previous = name
    builder.add_edge(previous, END)
    return builder.compile(checkpointer=checkpointer)


def identity(config):
    return config["configurable"]["thread_id"], config["configurable"]["lease"]
