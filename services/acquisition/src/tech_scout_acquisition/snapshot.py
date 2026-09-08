"""Versioned research projection; no dependency on Intelligence internals."""

from datetime import UTC, datetime

from .parsers import assignee_matches, normalized, stable_id

TABLES = (
    "patents",
    "patent-classifications",
    "patent-parties",
    "patent-domain-matches",
    "companies",
    "company-aliases",
    "external-identifiers",
    "company-relations",
    "company-patent-relations",
    "company-candidates",
    "entity-matches",
    "entity-review-decisions",
    "entity-evidence",
    "evaluations",
)


def provenance(record, run_id):
    return {
        k: record.get(k)
        for k in (
            "source_path",
            "source_url",
            "source_sha256",
            "source_row_number",
            "observed_at",
        )
    } | {"source_release": str(run_id)}


def build_snapshot(run_id, plan, patents, company_results):
    result = {table: [] for table in TABLES}
    result["source_mode"] = "browser"
    result["release"] = {
        "release_id": str(run_id),
        "dataset": "google-patents-riskbird",
        "period_from_year": plan["from_year"],
        "period_to_year": plan["to_year"],
        "published_at": datetime.now(UTC).isoformat(),
    }
    result["domains"] = [
        {**d, "definition": d, "rule_version": "browser-v1"} for d in plan["directions"]
    ]
    companies = {}
    candidates = {}
    for key, item in patents.items():
        src = provenance(item, run_id)
        date = item.get("publication_date")
        year = int(date[:4]) if date and date[:4].isdigit() else None
        result["patents"].append(
            {
                "patent_id": key,
                "patent_title": item["title"],
                "patent_date": date,
                "publication_year": year,
                "grant_year": int(item["grant_date"][:4])
                if item.get("grant_date")
                else None,
                "abstract": item.get("abstract"),
                "claims": item.get("claims"),
                "description": item.get("description"),
                "family_id": item.get("family_id"),
                "application_number": item.get("application_number"),
                "filing_date": item.get("filing_date"),
                **src,
            }
        )
        for cpc in item["cpcs"]:
            result["patent-classifications"].append(
                {"patent_id": key, "cpc_group": cpc, **src}
            )
        # Search membership is evidence of retrieval, not proof of technical capability.
        for domain in item.get("domain_ids", []):
            result["patent-domain-matches"].append(
                {
                    "patent_id": key,
                    "domain_id": domain,
                    "total_score": 1,
                    "evaluation_id": stable_id(key + ":" + domain),
                    "decision_reason": "Google Patents 检索命中，待研究相关性分析",
                    **src,
                }
            )
        names = list(
            dict.fromkeys(
                item.get("list_assignees", [])
                + item["current_assignees"]
                + item["original_assignees"]
            )
        )
        for name in names:
            cid = stable_id("candidate:" + normalized(name))
            party_id = stable_id(key + ":" + name)
            # Names and patent jurisdiction do not establish company domicile.
            country = None
            candidate = candidates.setdefault(
                cid,
                {
                    "candidate_id": cid,
                    "representative_name": name,
                    "name_normalized": normalized(name),
                    "country": country,
                    "patent_count": 0,
                    "first_patent_id": key,
                },
            )
            candidate["patent_count"] += 1
            roles = [
                role
                for role, values in (
                    ("search_listing", item.get("list_assignees", [])),
                    ("current_assignee", item["current_assignees"]),
                    ("original_assignee", item["original_assignees"]),
                )
                if name in values
            ]
            result["patent-parties"].append(
                {
                    "patent_id": key,
                    "patent_party_id": party_id,
                    "party_role": "assignee",
                    "source_roles": roles,
                    "party_name": name,
                    "party_name_normalized": normalized(name),
                    "country": country,
                    **(
                        provenance(item["list_source"], run_id)
                        if roles == ["search_listing"] and item.get("list_source")
                        else src
                    ),
                }
            )
            enrichment = company_results.get(normalized(name), {})
            candidate["lookup_status"] = enrichment.get("status", "unresolved")
            if not enrichment:
                matched = {
                    co["company_id"]: co
                    for response in company_results.values()
                    for co in response.get("companies", [])
                    if assignee_matches(name, co)
                }
                enrichment = {"companies": list(matched.values())}
            for company in enrichment.get("companies", []):
                coid = company["company_id"]
                csrc = provenance(company, run_id)
                companies[coid] = {
                    "company_id": coid,
                    "preferred_name": company["name"],
                    "legal_name": company["name"],
                    "country": "CN",
                    "provider": "riskbird",
                    "business_info": company["fields"],
                    **csrc,
                }
                evidence_id = stable_id(
                    cid + ":" + coid + ":" + company["source_sha256"]
                )
                result["entity-evidence"].append(
                    {
                        "candidate_id": cid,
                        "evidence_id": evidence_id,
                        "publisher": "riskbird",
                        "legal_name": company["name"],
                        "country": "CN",
                        "identifier_type": "USCC",
                        "identifier_value": company["credit_code"],
                        "preserved": True,
                        "content_sha256": company["source_sha256"],
                        **csrc,
                    }
                )
                result["external-identifiers"].append(
                    {
                        "company_id": coid,
                        "identifier_type": "USCC",
                        "identifier_value": company["credit_code"],
                        **csrc,
                    }
                )
                for alias in company["aliases"]:
                    result["company-aliases"].append(
                        {"company_id": coid, "alias_name": alias, **csrc}
                    )
                # A listing name is not sufficient evidence of current ownership.
                accepted = len(enrichment.get("companies", [])) == 1 and any(
                    assignee_matches(n, company) for n in item["current_assignees"]
                )
                result["entity-matches"].append(
                    {
                        "candidate_id": cid,
                        "suggested_company_id": coid,
                        "suggested_name": company["name"],
                        "is_accepted": accepted,
                        "decision": "accepted" if accepted else "unresolved",
                        "match_method": "name_alias_and_current_assignee"
                        if accepted
                        else "listing_name_only",
                        "decision_reason": "名称与当前权利人一致"
                        if accepted
                        else "企业已找到，专利归属仍待确认",
                    }
                )
                if accepted:
                    result["company-patent-relations"].append(
                        {
                            "company_id": coid,
                            "patent_id": key,
                            "patent_party_id": party_id,
                            "candidate_id": cid,
                            "match_method": "name_alias_and_current_assignee",
                            "entity_match_decision": "accepted",
                            **src,
                        }
                    )
    result["companies"] = list(companies.values())
    result["company-candidates"] = list(candidates.values())
    # Evidence/identifier rows are shared by many patents.
    for table in (
        "entity-evidence",
        "external-identifiers",
        "company-aliases",
        "entity-matches",
    ):
        import json

        result[table] = list(
            {json.dumps(r, sort_keys=True): r for r in result[table]}.values()
        )
    return result
