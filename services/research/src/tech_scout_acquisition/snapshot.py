"""Versioned research projection; companies and patent ownership stay independent."""

from datetime import UTC, datetime
from typing import Any

from .parsers import domestic_candidate, normalized, stable_id

TABLES = (
    "patents",
    "patent-classifications",
    "patent-parties",
    "patent-domain-matches",
    "assignee-candidates",
    "companies",
    "company-aliases",
    "external-identifiers",
    "company-search-hits",
    "evaluations",
)


def provenance(record, run_id):
    return {
        key: record.get(key)
        for key in (
            "source_path",
            "source_url",
            "source_sha256",
            "source_row_number",
            "observed_at",
        )
    } | {"source_release": str(run_id)}


def build_snapshot(run_id, plan, patents, company_results):
    result: dict[str, Any] = {table: [] for table in TABLES}
    result["source_mode"] = "browser"
    result["release"] = {
        "release_id": str(run_id),
        "dataset": "web-acquisition",
        "period_from_year": plan["from_year"],
        "period_to_year": plan["to_year"],
        "published_at": datetime.now(UTC).isoformat(),
        "workflow_version": "browser-v3",
    }
    result["domains"] = [
        {**direction, "definition": direction, "rule_version": "browser-v3"}
        for direction in plan["directions"]
    ]
    assignees: dict[str, dict] = {}
    for patent_id, item in patents.items():
        src = provenance(item, run_id)
        date = item.get("publication_date")
        year = int(date[:4]) if date and date[:4].isdigit() else None
        result["patents"].append(
            {
                "patent_id": patent_id,
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
                {"patent_id": patent_id, "cpc_group": cpc, **src}
            )
        for domain in item.get("domain_ids", []):
            result["patent-domain-matches"].append(
                {
                    "patent_id": patent_id,
                    "domain_id": domain,
                    "total_score": 1,
                    "evaluation_id": stable_id(patent_id + ":" + domain),
                    "decision_reason": (
                        "Google Patents 中国专利检索命中，待研究相关性分析"
                    ),
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
        preferred = set(item["current_assignees"] or item.get("list_assignees", []))
        for name in names:
            query_key = normalized(name)
            assignee_id = stable_id("assignee:" + query_key)
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
                    "patent_id": patent_id,
                    "patent_party_id": stable_id(patent_id + ":" + name),
                    "assignee_id": assignee_id,
                    "party_role": "assignee",
                    "source_roles": roles,
                    "party_name": name,
                    "party_name_normalized": query_key,
                    "country": None,
                    **(
                        provenance(item["list_source"], run_id)
                        if roles == ["search_listing"] and item.get("list_source")
                        else src
                    ),
                }
            )
            if name not in preferred or not domestic_candidate(name):
                continue
            candidate = assignees.setdefault(
                assignee_id,
                {
                    "assignee_id": assignee_id,
                    "name": name,
                    "name_normalized": query_key,
                    "query_key": query_key,
                    "patent_ids": [],
                    "source_roles": [],
                },
            )
            candidate["patent_ids"] = sorted(set(candidate["patent_ids"]) | {patent_id})
            candidate["source_roles"] = sorted(
                set(candidate["source_roles"]) | set(roles)
            )
    result["assignee-candidates"] = list(assignees.values())

    companies: dict[str, dict] = {}
    aliases: dict[tuple[str, str], dict] = {}
    identifiers: dict[str, dict] = {}
    for query_key, response in company_results.items():
        assignee_id = stable_id("assignee:" + query_key)
        assignee = assignees.get(assignee_id)
        if not assignee:
            continue
        for company in response.get("companies", []):
            company_id = company["company_id"]
            src = provenance(company, run_id)
            companies[company_id] = {
                "company_id": company_id,
                "preferred_name": company["name"],
                "legal_name": company["name"],
                "english_name": company.get("english_name"),
                "country": company.get("country") or "CN",
                "provider": company.get("provider") or "tianyancha",
                "business_info": company["fields"],
                **src,
            }
            identifiers[company_id] = {
                "company_id": company_id,
                "identifier_type": "USCC",
                "identifier_value": company["credit_code"],
                **src,
            }
            for alias in company["aliases"]:
                aliases[(company_id, alias)] = {
                    "company_id": company_id,
                    "alias_name": alias,
                    **src,
                }
            result["company-search-hits"].append(
                {
                    "research_id": str(run_id),
                    "assignee_id": assignee_id,
                    "query_name": assignee["name"],
                    "query_key": query_key,
                    "company_id": company_id,
                    "provider_rank": int(company.get("provider_rank", 0)),
                    **src,
                }
            )
    result["companies"] = list(companies.values())
    result["company-aliases"] = list(aliases.values())
    result["external-identifiers"] = list(identifiers.values())
    return result
