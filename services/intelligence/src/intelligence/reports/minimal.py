"""Build and verify a deterministic minimal domain research report."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from intelligence.datasets.catalog import _connect, verify_catalog_release

VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
DOMAIN_PATTERN = re.compile(r"^[a-z0-9_]+$")

DOMAIN_SQL = """
SELECT domain_id, name, rule_version, definition
FROM catalog.domain
WHERE domain_id = %s
"""

DOMAIN_PATENTS_SQL = """
SELECT p.patent_id
FROM catalog.patent p
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE m.domain_id = %s
ORDER BY p.patent_id
"""

YEAR_TREND_SQL = """
SELECT p.grant_year, count(*) AS patent_count
FROM catalog.patent p
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE m.domain_id = %s
GROUP BY p.grant_year
ORDER BY p.grant_year
"""

CPC_GROUPS_SQL = """
SELECT c.cpc_group, count(DISTINCT c.patent_id) AS patent_count
FROM catalog.patent_classification c
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE m.domain_id = %s
GROUP BY c.cpc_group
ORDER BY patent_count DESC, c.cpc_group
"""

COMPANY_RANKING_SQL = """
SELECT c.company_id,
       c.preferred_name,
       c.country,
       c.legal_name,
       c.provider,
       c.source_path,
       trim(c.source_sha256) AS source_sha256,
       c.source_row_number,
       count(DISTINCT r.patent_id) AS patent_count,
       EXISTS (
           SELECT 1
           FROM catalog.entity_match em
           WHERE em.suggested_company_id = c.company_id
             AND em.is_accepted
       ) AS is_accepted
FROM catalog.company_entity c
JOIN catalog.company_patent_relation r USING (company_id)
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE m.domain_id = %s
GROUP BY c.company_id, c.preferred_name, c.country, c.legal_name,
         c.provider, c.source_path, c.source_sha256, c.source_row_number
ORDER BY patent_count DESC, c.company_id
"""

ACCEPTED_CANDIDATES_SQL = """
SELECT count(DISTINCT candidate_id) AS accepted_candidate_count
FROM catalog.entity_match
WHERE is_accepted
"""

PENDING_REVIEW_SQL = """
SELECT count(*) AS pending_review_count
FROM catalog.entity_review
WHERE release_id = %s
"""

COMPANY_ALIASES_SQL = """
SELECT alias_id, alias_name, alias_type, source_provider
FROM catalog.company_alias
WHERE company_id = %s
ORDER BY alias_type, alias_normalized, alias_id
"""

COMPANY_IDENTIFIERS_SQL = """
SELECT external_identifier_id, identifier_type, identifier_value, provider
FROM catalog.external_identifier
WHERE company_id = %s
ORDER BY identifier_type, identifier_value, external_identifier_id
"""

COMPANY_MATCHES_SQL = """
SELECT em.entity_match_id,
       em.candidate_id,
       cc.representative_name,
       em.match_method,
       em.similarity_score,
       em.decision,
       em.decision_reason,
       em.reviewer,
       em.reviewer_note
FROM catalog.entity_match em
JOIN catalog.company_candidate cc USING (candidate_id)
WHERE em.suggested_company_id = %s
  AND em.is_accepted
ORDER BY cc.patent_count DESC, em.candidate_id, em.entity_match_id
"""

COMPANY_PATENTS_SQL = """
SELECT DISTINCT p.patent_id,
       p.patent_title,
       p.patent_date,
       p.grant_year,
       m.total_score,
       m.rule_version,
       p.source_path,
       trim(p.source_sha256) AS source_sha256,
       p.source_row_number
FROM catalog.company_patent_relation r
JOIN catalog.patent p USING (patent_id)
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE r.company_id = %s
  AND m.domain_id = %s
ORDER BY m.total_score DESC, p.patent_date DESC, p.patent_id
"""

COMPANY_CPC_SQL = """
SELECT c.cpc_group, count(DISTINCT c.patent_id) AS patent_count
FROM catalog.company_patent_relation r
JOIN catalog.patent_classification c USING (patent_id)
JOIN catalog.patent_domain_match m USING (patent_id)
WHERE r.company_id = %s
  AND m.domain_id = %s
GROUP BY c.cpc_group
ORDER BY patent_count DESC, c.cpc_group
"""

SOURCE_PAIRS_SQL = """
SELECT source_path,
       trim(source_sha256) AS source_sha256,
       min(source_row_number) AS source_row_number
FROM (
    SELECT source_path, source_sha256, source_row_number FROM catalog.patent
    UNION ALL
    SELECT source_path, source_sha256, source_row_number
    FROM catalog.company_entity
    UNION ALL
    SELECT source_path, source_sha256, source_row_number
    FROM catalog.patent_classification
    UNION ALL
    SELECT source_path, source_sha256, source_row_number
    FROM catalog.patent_party
) records
GROUP BY source_path, source_sha256
ORDER BY source_path, source_sha256
"""

QUERY_SQL = {
    "domain": DOMAIN_SQL,
    "domain-patents": DOMAIN_PATENTS_SQL,
    "year-trend": YEAR_TREND_SQL,
    "cpc-groups": CPC_GROUPS_SQL,
    "company-ranking": COMPANY_RANKING_SQL,
    "accepted-candidates": ACCEPTED_CANDIDATES_SQL,
    "pending-review": PENDING_REVIEW_SQL,
    "company-aliases": COMPANY_ALIASES_SQL,
    "company-identifiers": COMPANY_IDENTIFIERS_SQL,
    "company-matches": COMPANY_MATCHES_SQL,
    "company-patents": COMPANY_PATENTS_SQL,
    "company-cpc": COMPANY_CPC_SQL,
    "source-pairs": SOURCE_PAIRS_SQL,
}


@dataclass(frozen=True)
class ReportInputs:
    catalog_release: dict[str, Any]
    silver_manifest: dict[str, Any]
    bronze_manifest: dict[str, Any]
    source_manifest: dict[str, Any]
    spec: dict[str, Any]
    paths: dict[str, Path]
    hashes: dict[str, str]


class ReportError(RuntimeError):
    """Raised when report inputs or artifacts fail validation."""


def select_top_companies(
    companies: list[dict[str, Any]], *, limit: int
) -> list[dict[str, Any]]:
    """Return accepted companies in deterministic report order."""
    accepted = [company for company in companies if company["isAccepted"]]
    return sorted(
        accepted,
        key=lambda company: (-company["patentCount"], company["companyId"]),
    )[:limit]


def select_representative_patents(
    patents: list[dict[str, Any]], *, limit: int
) -> list[dict[str, Any]]:
    """Deduplicate patents and apply the report's stable relevance ordering."""
    unique = {patent["patentId"]: patent for patent in patents}
    ranked = sorted(unique.values(), key=lambda patent: patent["patentId"])
    ranked.sort(key=lambda patent: str(patent["patentDate"]), reverse=True)
    ranked.sort(key=lambda patent: patent["totalScore"], reverse=True)
    return ranked[:limit]


def select_company_aliases(
    aliases: list[dict[str, Any]], *, primary_name: str, limit: int
) -> list[dict[str, Any]]:
    """Return distinct aliases without repeating the primary company name."""
    selected = []
    seen = {primary_name.strip()}
    for alias in aliases:
        name = alias["aliasName"].strip()
        if not name or name in seen:
            continue
        seen.add(name)
        selected.append(alias)
        if len(selected) == limit:
            break
    return selected


def resolve_source_record(
    source_manifest: dict[str, Any],
    *,
    source_path: str,
    source_sha256: str,
    source_row_number: int,
) -> dict[str, Any]:
    """Resolve a Catalog row locator against the immutable source manifest."""
    if source_row_number <= 0:
        raise ReportError("Source row number must be positive")
    normalized_hash = source_sha256.strip()
    for entry in source_manifest.get("files", []):
        if entry.get("path") == source_path and entry.get("sha256") == normalized_hash:
            return {
                "provider": entry.get("provider"),
                "dataset": entry.get("dataset"),
                "sourceUrl": entry.get("sourceUrl"),
                "sourcePath": source_path,
                "sourceSha256": normalized_hash,
                "sourceRowNumber": source_row_number,
                "downloadedAt": entry.get("downloadedAt"),
                "observedMtimeUtc": entry.get("observedMtimeUtc"),
                "license": entry.get("license"),
            }
    raise ReportError(
        f"Source path/hash is not registered: {source_path} ({normalized_hash})"
    )


def validate_report_data(report_data: dict[str, Any]) -> dict[str, Any]:
    """Validate citation coverage and return deterministic quality metrics."""
    citations = report_data.get("citations", [])
    citation_ids = {citation.get("citationId") for citation in citations}
    facts = report_data.get("facts", [])
    key_facts = [fact for fact in facts if fact.get("isKeyFact")]
    for fact in key_facts:
        fact_id = fact.get("factId", "<unknown>")
        references = fact.get("citationIds") or []
        if not references:
            raise ReportError(f"Key fact has no citation: {fact_id}")
        missing = [
            reference for reference in references if reference not in citation_ids
        ]
        if missing:
            raise ReportError(f"Key fact {fact_id} has unknown citations: {missing}")
    covered = sum(bool(fact.get("citationIds")) for fact in key_facts)
    coverage = covered / len(key_facts) if key_facts else 1.0
    return {
        "factCount": len(facts),
        "keyFactCount": len(key_facts),
        "citationCount": len(citations),
        "keyFactCitationCoverage": coverage,
    }


def _markdown_cell(value: Any) -> str:
    if value is None or value == "":
        return "—"
    return str(value).replace("|", "\\|").replace("\n", " ")


def _citation_ref(citation_id: str | None) -> str:
    return f" [{citation_id}]" if citation_id else ""


def render_markdown(report_data: dict[str, Any]) -> str:
    """Render the fixed Chinese Data Gate report template."""
    domain = report_data["domain"]
    metrics = report_data["metrics"]
    lines = [
        f"# {report_data['title']}",
        "",
        f"> 生成时间：{report_data['generatedAt']}",
        f"> Catalog release：`{report_data['catalogRelease']}`",
        f"> 数据截止时间：{report_data['dataCutoff']}",
        "",
        "## 1. 研究问题、范围与数据版本",
        "",
        f"本报告研究 `{domain['name']}`（`{domain['domainId']}`）领域，"
        "验证从技术领域到公司、专利、匹配依据和原始来源的本地数据链路。",
        "报告仅反映当前 Catalog 范围内的美国授权专利，不代表市场份额或公司竞争力。",
        "",
        "## 2. 检索策略与方法",
        "",
        f"领域规则版本：`{report_data['methodology']['ruleVersion']}`。"
        "筛选使用完整 CPC、标题关键词和排除词，未使用 LLM 决定专利是否入库。",
        "公司排名只使用已经自动接受或人工接受的实体匹配，按去重专利数排序。",
        "",
        "## 3. 核心统计、年度趋势与主要 CPC",
        "",
        f"- 领域专利：**{metrics['patentCount']:,}** 件。"
        f"{_citation_ref(metrics.get('patentCountCitationId'))}",
        f"- 已接受公司候选：**{metrics['acceptedCandidateCount']:,}** 个。"
        f"{_citation_ref(metrics.get('acceptedCandidateCitationId'))}",
        f"- 待审核或未匹配候选：**{metrics['pendingReviewCount']:,}** 个。"
        f"{_citation_ref(metrics.get('pendingReviewCitationId'))}",
        "",
        "### 年度趋势",
        "",
        "| 授权年份 | 专利数 | 引用 |",
        "| ---: | ---: | --- |",
    ]
    lines.extend(
        f"| {row['year']} | {row['patentCount']:,} | "
        f"{_citation_ref(row.get('citationId')).strip()} |"
        for row in report_data["yearTrend"]
    )
    lines.extend(
        [
            "",
            "### 主要 CPC",
            "",
            "| CPC group | 去重专利数 | 引用 |",
            "| --- | ---: | --- |",
        ]
    )
    lines.extend(
        f"| `{_markdown_cell(row['cpcGroup'])}` | {row['patentCount']:,} | "
        f"{_citation_ref(row.get('citationId')).strip()} |"
        for row in report_data["topCpcGroups"]
    )
    lines.extend(
        [
            "",
            "## 4. 重点公司长名单",
            "",
            "| 排名 | 公司 | 国家/地区 | 相关专利数 | 引用 |",
            "| ---: | --- | --- | ---: | --- |",
        ]
    )
    lines.extend(
        "| {rank} | {name} (`{company_id}`) | {country} | {count:,} | "
        "{citation} |".format(
            rank=company["rank"],
            name=_markdown_cell(company["preferredName"]),
            company_id=company["companyId"],
            country=_markdown_cell(company.get("country")),
            count=company["patentCount"],
            citation=_citation_ref(company.get("rankingCitationId")).strip(),
        )
        for company in report_data["companies"]
    )
    lines.extend(["", "## 5. 公司匹配证据与代表专利", ""])
    for company in report_data["companies"]:
        lines.extend(
            [
                f"### {company['rank']}. {company['preferredName']}",
                "",
                f"- Company ID：`{company['companyId']}`。",
                f"- 国家/地区：{_markdown_cell(company.get('country'))}。",
                f"- 当前领域相关专利：{company['patentCount']:,} 件。",
            ]
        )
        decisions = sorted(
            {
                evidence["decision"]
                for evidence in company.get("matchEvidence", [])
            }
        )
        if decisions:
            lines.append(
                f"- 匹配决策：{', '.join(decisions)}。"
                f"{_citation_ref(company.get('matchCitationId'))}"
            )
        aliases = company.get("aliases", [])
        if aliases:
            alias_names = ", ".join(alias["aliasName"] for alias in aliases)
            lines.append(f"- 已登记别名：{alias_names}。")
        identifiers = company.get("externalIdentifiers", [])
        if identifiers:
            identifier_text = ", ".join(
                f"{item['identifierType']} `{item['identifierValue']}`"
                for item in identifiers
            )
            lines.append(f"- 外部标识：{identifier_text}。")
        lines.extend(
            [
                "",
                "| 专利号 | 标题 | 授权日 | 分数 | 引用 |",
                "| --- | --- | --- | ---: | --- |",
            ]
        )
        lines.extend(
            "| `{patent_id}` | {title} | {date} | {score} | [{citation}] |".format(
                patent_id=patent["patentId"],
                title=_markdown_cell(patent["patentTitle"]),
                date=patent["patentDate"],
                score=patent["totalScore"],
                citation=patent["citationId"],
            )
            for patent in company["representativePatents"]
        )
        lines.append("")
    lines.extend(
        [
            "## 6. 数据质量、审核状态与排名解释",
            "",
            "公司排名是当前数据范围内的相关授权专利计数，不是市场份额、营收、估值或综合竞争力排名。",
            f"仍有 {metrics['pendingReviewCount']:,} 个候选处于待审核或未匹配状态；"
            "未命中不能解释为主体不存在。",
            "",
            "## 7. 信息缺口与后续调查建议",
            "",
            "当前不可用字段："
            + "、".join(f"`{field}`" for field in report_data["unavailableFields"])
            + "。",
        ]
    )
    lines.extend(f"- {limitation}" for limitation in report_data["limitations"])
    lines.extend(
        [
            "- 如需语义检索，下一步补充专利摘要。",
            "- 如需保护范围与价值分析，补充权利要求、引用、专利族和法律状态。",
            "- 如需商业判断，另行采集财务、产品、新闻和市场数据。",
            "",
            "## 8. 完整引用与执行记录",
            "",
            "| 引用 ID | 类型 | 来源 | URL | 定位 | 原始值/说明 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for citation in report_data["citations"]:
        provider = citation.get("provider") or ", ".join(
            citation.get("providers", [])
        )
        source_url = citation.get("sourceUrl") or ", ".join(
            citation.get("sourceUrls", [])
        )
        lines.append(
            "| [{citation_id}] | {citation_type} | {provider} | {url} | "
            "{locator} | {excerpt} |".format(
                citation_id=citation["citationId"],
                citation_type=_markdown_cell(citation["citationType"]),
                provider=_markdown_cell(provider),
                url=_markdown_cell(source_url),
                locator=_markdown_cell(citation.get("locator")),
                excerpt=_markdown_cell(citation.get("excerpt")),
            )
        )
    lines.extend(
        [
            "",
            f"查询版本：`{report_data['queryVersion']}`。",
            "报告通过只读 Catalog 查询和固定模板生成，没有调用第三方 API 或 LLM。",
            "",
        ]
    )
    return "\n".join(lines)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _default_spec_path() -> Path:
    return _repo_root() / "config" / "reports" / "minimal-domain-research-v1.json"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_default(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"Value is not JSON serializable: {type(value).__name__}")


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    )


def _content_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReportError(f"Cannot read JSON: {path}: {error}") from error
    if not isinstance(value, dict):
        raise ReportError(f"JSON root must be an object: {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, default=_json_default) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _verified_json(path: Path, expected_hash: str, label: str) -> dict[str, Any]:
    path = path.resolve()
    if not path.is_file():
        raise ReportError(f"{label} is missing: {path}")
    actual_hash = _sha256_file(path)
    if actual_hash != expected_hash:
        raise ReportError(
            f"{label} SHA-256 mismatch: expected {expected_hash}, got {actual_hash}"
        )
    return _read_json(path)


def _load_inputs(
    db_config: Path, release: str, spec_path: Path | None = None
) -> ReportInputs:
    spec_path = (spec_path or _default_spec_path()).resolve()
    if not spec_path.is_file():
        raise ReportError(f"Report specification is missing: {spec_path}")
    spec_hash = _sha256_file(spec_path)
    spec = _read_json(spec_path)
    with _connect(db_config.resolve()) as connection:
        release_row = connection.execute(
            """
            SELECT release_id, release_status, manifest_path,
                   trim(manifest_sha256) AS manifest_sha256, manifest
            FROM catalog.dataset_release
            WHERE release_id = %s
            """,
            (release,),
        ).fetchone()
    if not release_row:
        raise ReportError(f"Catalog release does not exist: {release}")
    if release_row["release_status"] != "published":
        raise ReportError(f"Catalog release is not published: {release}")
    silver_path = Path(release_row["manifest_path"]).resolve()
    verify_catalog_release(db_config.resolve(), release, silver_path)
    silver_manifest = _verified_json(
        silver_path, release_row["manifest_sha256"], "Silver manifest"
    )
    if silver_manifest.get("release") != release:
        raise ReportError("Silver manifest release does not match Catalog release")
    bronze_entry = silver_manifest.get("bronzeManifest") or {}
    bronze_path = Path(bronze_entry.get("path", "")).resolve()
    bronze_manifest = _verified_json(
        bronze_path, bronze_entry.get("sha256", ""), "Bronze manifest"
    )
    source_entry = bronze_manifest.get("sourceManifest") or {}
    source_path = Path(source_entry.get("path", "")).resolve()
    source_manifest = _verified_json(
        source_path, source_entry.get("sha256", ""), "Source manifest"
    )
    rules_entry = silver_manifest.get("rules") or {}
    rules_path = Path(rules_entry.get("path", "")).resolve()
    if not rules_path.is_file():
        raise ReportError(f"Rules file is missing: {rules_path}")
    rules_hash = _sha256_file(rules_path)
    if rules_hash != rules_entry.get("sha256"):
        raise ReportError("Rules file SHA-256 mismatch")
    return ReportInputs(
        catalog_release=dict(release_row),
        silver_manifest=silver_manifest,
        bronze_manifest=bronze_manifest,
        source_manifest=source_manifest,
        spec=spec,
        paths={
            "silverManifest": silver_path,
            "bronzeManifest": bronze_path,
            "sourceManifest": source_path,
            "rules": rules_path,
            "spec": spec_path,
        },
        hashes={
            "silverManifest": release_row["manifest_sha256"],
            "bronzeManifest": bronze_entry["sha256"],
            "sourceManifest": source_entry["sha256"],
            "rules": rules_hash,
            "spec": spec_hash,
        },
    )


def _query(
    connection: psycopg.Connection[Any],
    *,
    query_id: str,
    statement: str,
    parameters: tuple[Any, ...] = (),
    record_key: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows = [dict(row) for row in connection.execute(statement, parameters).fetchall()]
    json_rows = json.loads(_canonical_json(rows))
    normalized_sql = " ".join(statement.split())
    record_ids = []
    if record_key:
        record_ids = [row[record_key] for row in json_rows if row.get(record_key)]
    evidence = {
        "queryId": query_id,
        "sqlSha256": hashlib.sha256(normalized_sql.encode("utf-8")).hexdigest(),
        "parameters": json.loads(_canonical_json(parameters)),
        "rowCount": len(json_rows),
        "resultSha256": _content_sha256(json_rows),
        "recordIds": record_ids,
    }
    return json_rows, evidence


def _citation_suffix(*values: Any) -> str:
    return hashlib.sha256("|".join(map(str, values)).encode("utf-8")).hexdigest()[:16]


def _source_citation(
    source_manifest: dict[str, Any],
    *,
    record_type: str,
    record_id: str,
    original_value: str,
    source_path: str,
    source_sha256: str,
    source_row_number: int,
) -> dict[str, Any]:
    source = resolve_source_record(
        source_manifest,
        source_path=source_path,
        source_sha256=source_sha256,
        source_row_number=source_row_number,
    )
    citation_id = "cit-source-" + _citation_suffix(
        record_type, record_id, source_path, source_row_number
    )
    return {
        "citationId": citation_id,
        "citationType": "source_record",
        "recordType": record_type,
        "recordId": record_id,
        **source,
        "locator": f"{source_path}:{source_row_number}",
        "excerpt": original_value,
        "inference": False,
    }


def _query_citation(
    evidence: dict[str, Any],
    source_manifest: dict[str, Any],
    *,
    datasets: set[str],
    release: str,
) -> dict[str, Any]:
    entries = [
        entry
        for entry in source_manifest.get("files", [])
        if entry.get("dataset") in datasets
    ]
    providers = sorted(
        {entry.get("provider") for entry in entries if entry.get("provider")}
    )
    urls = sorted(
        {entry.get("sourceUrl") for entry in entries if entry.get("sourceUrl")}
    )
    citation_id = "cit-query-" + _citation_suffix(evidence["queryId"])
    return {
        "citationId": citation_id,
        "citationType": "catalog_query",
        "queryId": evidence["queryId"],
        "providers": providers,
        "sourceUrls": urls,
        "catalogRelease": release,
        "locator": (
            f"catalog@{release}:{evidence['queryId']}:"
            f"{evidence['resultSha256'][:16]}"
        ),
        "excerpt": (
            f"只读查询返回 {evidence['rowCount']} 行；"
            f"结果 SHA-256 {evidence['resultSha256']}"
        ),
        "inference": True,
    }


def _add_citation(
    citations: dict[str, dict[str, Any]], citation: dict[str, Any]
) -> str:
    citation_id = citation["citationId"]
    existing = citations.get(citation_id)
    if existing and existing != citation:
        raise ReportError(f"Citation ID collision: {citation_id}")
    citations[citation_id] = citation
    return citation_id


def _fact(
    fact_id: str,
    fact_type: str,
    value: Any,
    citation_ids: list[str],
    *,
    derived: bool,
) -> dict[str, Any]:
    return {
        "factId": fact_id,
        "factType": fact_type,
        "value": value,
        "isKeyFact": True,
        "derived": derived,
        "citationIds": citation_ids,
    }


def _collect_report_data(
    db_config: Path,
    inputs: ReportInputs,
    *,
    domain_id: str,
    version: str,
    generated_at: str,
) -> dict[str, Any]:
    spec = inputs.spec
    release = inputs.catalog_release["release_id"]
    evidence_list: list[dict[str, Any]] = []
    citations: dict[str, dict[str, Any]] = {}
    facts: list[dict[str, Any]] = []

    with _connect(db_config.resolve()) as connection:
        connection.execute("SET TRANSACTION READ ONLY")
        domain_rows, domain_evidence = _query(
            connection,
            query_id="domain",
            statement=DOMAIN_SQL,
            parameters=(domain_id,),
            record_key="domain_id",
        )
        if len(domain_rows) != 1:
            raise ReportError(f"Domain does not exist: {domain_id}")
        domain_row = domain_rows[0]
        evidence_list.append(domain_evidence)

        patent_rows, patent_evidence = _query(
            connection,
            query_id="domain-patents",
            statement=DOMAIN_PATENTS_SQL,
            parameters=(domain_id,),
            record_key="patent_id",
        )
        evidence_list.append(patent_evidence)
        patent_count = len(patent_rows)
        if patent_count < spec["minimumPatentCount"]:
            raise ReportError(
                f"Domain has only {patent_count} patents; "
                f"minimum is {spec['minimumPatentCount']}"
            )
        patent_query_citation = _add_citation(
            citations,
            _query_citation(
                patent_evidence,
                inputs.source_manifest,
                datasets={"uspto-pvgpatdis", "uspto-pvannual"},
                release=release,
            ),
        )
        facts.append(
            _fact(
                "fact-domain-patent-count",
                "domain_patent_count",
                patent_count,
                [patent_query_citation],
                derived=True,
            )
        )

        year_rows, year_evidence = _query(
            connection,
            query_id="year-trend",
            statement=YEAR_TREND_SQL,
            parameters=(domain_id,),
        )
        evidence_list.append(year_evidence)
        year_citation = _add_citation(
            citations,
            _query_citation(
                year_evidence,
                inputs.source_manifest,
                datasets={"uspto-pvgpatdis"},
                release=release,
            ),
        )
        year_trend = []
        for row in year_rows:
            year = row["grant_year"]
            count = row["patent_count"]
            year_trend.append(
                {"year": year, "patentCount": count, "citationId": year_citation}
            )
            facts.append(
                _fact(
                    f"fact-year-{year}",
                    "year_patent_count",
                    {"year": year, "patentCount": count},
                    [year_citation],
                    derived=True,
                )
            )
        if sum(row["patentCount"] for row in year_trend) != patent_count:
            raise ReportError("Year trend does not sum to the domain patent count")

        cpc_rows, cpc_evidence = _query(
            connection,
            query_id="cpc-groups",
            statement=CPC_GROUPS_SQL,
            parameters=(domain_id,),
        )
        evidence_list.append(cpc_evidence)
        cpc_citation = _add_citation(
            citations,
            _query_citation(
                cpc_evidence,
                inputs.source_manifest,
                datasets={"uspto-pvgpatdis"},
                release=release,
            ),
        )
        top_cpc_groups = []
        for row in cpc_rows[: spec["topCpcGroupCount"]]:
            item = {
                "cpcGroup": row["cpc_group"],
                "patentCount": row["patent_count"],
                "citationId": cpc_citation,
            }
            top_cpc_groups.append(item)
            facts.append(
                _fact(
                    "fact-cpc-" + _citation_suffix(row["cpc_group"]),
                    "cpc_patent_count",
                    item,
                    [cpc_citation],
                    derived=True,
                )
            )

        accepted_rows, accepted_evidence = _query(
            connection,
            query_id="accepted-candidates",
            statement=ACCEPTED_CANDIDATES_SQL,
        )
        evidence_list.append(accepted_evidence)
        accepted_count = accepted_rows[0]["accepted_candidate_count"]
        if accepted_count < spec["minimumAcceptedCompanyCount"]:
            raise ReportError(
                f"Only {accepted_count} accepted company candidates are available"
            )
        accepted_citation = _add_citation(
            citations,
            _query_citation(
                accepted_evidence,
                inputs.source_manifest,
                datasets={"gleif-level1", "sec-company-tickers"},
                release=release,
            ),
        )
        facts.append(
            _fact(
                "fact-accepted-candidates",
                "accepted_candidate_count",
                accepted_count,
                [accepted_citation],
                derived=True,
            )
        )

        review_rows, review_evidence = _query(
            connection,
            query_id="pending-review",
            statement=PENDING_REVIEW_SQL,
            parameters=(release,),
        )
        evidence_list.append(review_evidence)
        pending_count = review_rows[0]["pending_review_count"]
        review_citation = _add_citation(
            citations,
            _query_citation(
                review_evidence,
                inputs.source_manifest,
                datasets={"uspto-pvannual", "gleif-level1", "sec-company-tickers"},
                release=release,
            ),
        )
        facts.append(
            _fact(
                "fact-pending-review",
                "pending_review_count",
                pending_count,
                [review_citation],
                derived=True,
            )
        )

        ranking_rows, ranking_evidence = _query(
            connection,
            query_id="company-ranking",
            statement=COMPANY_RANKING_SQL,
            parameters=(domain_id,),
            record_key="company_id",
        )
        evidence_list.append(ranking_evidence)
        ranking_citation = _add_citation(
            citations,
            _query_citation(
                ranking_evidence,
                inputs.source_manifest,
                datasets={"uspto-pvannual", "gleif-level1", "sec-company-tickers"},
                release=release,
            ),
        )
        ranking_candidates = [
            {
                "companyId": row["company_id"],
                "preferredName": row["preferred_name"],
                "country": row["country"],
                "legalName": row["legal_name"],
                "provider": row["provider"],
                "sourcePath": row["source_path"],
                "sourceSha256": row["source_sha256"],
                "sourceRowNumber": row["source_row_number"],
                "patentCount": row["patent_count"],
                "isAccepted": row["is_accepted"],
            }
            for row in ranking_rows
        ]
        selected_companies = select_top_companies(
            ranking_candidates, limit=spec["topCompanyCount"]
        )
        if len(selected_companies) != spec["topCompanyCount"]:
            raise ReportError(
                "The domain does not have enough accepted ranked companies"
            )

        source_pair_rows, source_pair_evidence = _query(
            connection,
            query_id="source-pairs",
            statement=SOURCE_PAIRS_SQL,
        )
        evidence_list.append(source_pair_evidence)
        for row in source_pair_rows:
            resolve_source_record(
                inputs.source_manifest,
                source_path=row["source_path"],
                source_sha256=row["source_sha256"],
                source_row_number=row["source_row_number"],
            )

        companies = []
        for rank, company in enumerate(selected_companies, start=1):
            company_id = company["companyId"]
            company_key = _citation_suffix(company_id)
            company_citation = _add_citation(
                citations,
                _source_citation(
                    inputs.source_manifest,
                    record_type="company",
                    record_id=company_id,
                    original_value=company.get("legalName")
                    or company["preferredName"],
                    source_path=company["sourcePath"],
                    source_sha256=company["sourceSha256"],
                    source_row_number=company["sourceRowNumber"],
                ),
            )
            facts.append(
                _fact(
                    f"fact-company-{company_key}-identity",
                    "company_identity",
                    {
                        "companyId": company_id,
                        "preferredName": company["preferredName"],
                        "country": company["country"],
                    },
                    [company_citation],
                    derived=False,
                )
            )
            facts.append(
                _fact(
                    f"fact-company-{company_key}-patent-count",
                    "company_domain_patent_count",
                    company["patentCount"],
                    [ranking_citation],
                    derived=True,
                )
            )

            alias_rows, alias_evidence = _query(
                connection,
                query_id=f"company-aliases-{company_key}",
                statement=COMPANY_ALIASES_SQL,
                parameters=(company_id,),
                record_key="alias_id",
            )
            evidence_list.append(alias_evidence)
            alias_candidates = [
                {
                    "aliasId": row["alias_id"],
                    "aliasName": row["alias_name"],
                    "aliasType": row["alias_type"],
                    "sourceProvider": row["source_provider"],
                }
                for row in alias_rows
            ]
            aliases = select_company_aliases(
                alias_candidates,
                primary_name=company["preferredName"],
                limit=spec["companyAliasCount"],
            )

            identifier_rows, identifier_evidence = _query(
                connection,
                query_id=f"company-identifiers-{company_key}",
                statement=COMPANY_IDENTIFIERS_SQL,
                parameters=(company_id,),
                record_key="external_identifier_id",
            )
            evidence_list.append(identifier_evidence)
            identifiers = [
                {
                    "externalIdentifierId": row["external_identifier_id"],
                    "identifierType": row["identifier_type"],
                    "identifierValue": row["identifier_value"],
                    "provider": row["provider"],
                }
                for row in identifier_rows
            ]

            match_rows, match_evidence = _query(
                connection,
                query_id=f"company-matches-{company_key}",
                statement=COMPANY_MATCHES_SQL,
                parameters=(company_id,),
                record_key="entity_match_id",
            )
            evidence_list.append(match_evidence)
            match_citation = _add_citation(
                citations,
                _query_citation(
                    match_evidence,
                    inputs.source_manifest,
                    datasets={"uspto-pvannual", "gleif-level1", "sec-company-tickers"},
                    release=release,
                ),
            )
            matches = [
                {
                    "entityMatchId": row["entity_match_id"],
                    "candidateId": row["candidate_id"],
                    "representativeName": row["representative_name"],
                    "matchMethod": row["match_method"],
                    "similarityScore": row["similarity_score"],
                    "decision": row["decision"],
                    "decisionReason": row["decision_reason"],
                    "reviewer": row["reviewer"],
                    "reviewerNote": row["reviewer_note"],
                }
                for row in match_rows
            ]
            facts.append(
                _fact(
                    f"fact-company-{company_key}-match",
                    "company_match_decision",
                    [row["decision"] for row in matches],
                    [match_citation, company_citation],
                    derived=True,
                )
            )

            company_patent_rows, company_patent_evidence = _query(
                connection,
                query_id=f"company-patents-{company_key}",
                statement=COMPANY_PATENTS_SQL,
                parameters=(company_id, domain_id),
                record_key="patent_id",
            )
            evidence_list.append(company_patent_evidence)
            company_patent_query_citation = _add_citation(
                citations,
                _query_citation(
                    company_patent_evidence,
                    inputs.source_manifest,
                    datasets={"uspto-pvgpatdis", "uspto-pvannual"},
                    release=release,
                ),
            )
            patent_candidates = [
                {
                    "patentId": row["patent_id"],
                    "patentTitle": row["patent_title"],
                    "patentDate": row["patent_date"],
                    "grantYear": row["grant_year"],
                    "totalScore": row["total_score"],
                    "ruleVersion": row["rule_version"],
                    "sourcePath": row["source_path"],
                    "sourceSha256": row["source_sha256"],
                    "sourceRowNumber": row["source_row_number"],
                }
                for row in company_patent_rows
            ]
            representative_patents = []
            for patent in select_representative_patents(
                patent_candidates, limit=spec["representativePatentCount"]
            ):
                patent_citation = _add_citation(
                    citations,
                    _source_citation(
                        inputs.source_manifest,
                        record_type="patent",
                        record_id=patent["patentId"],
                        original_value=patent["patentTitle"],
                        source_path=patent["sourcePath"],
                        source_sha256=patent["sourceSha256"],
                        source_row_number=patent["sourceRowNumber"],
                    ),
                )
                output_patent = {
                    "patentId": patent["patentId"],
                    "patentTitle": patent["patentTitle"],
                    "patentDate": patent["patentDate"],
                    "grantYear": patent["grantYear"],
                    "totalScore": patent["totalScore"],
                    "ruleVersion": patent["ruleVersion"],
                    "citationId": patent_citation,
                }
                representative_patents.append(output_patent)
                facts.append(
                    _fact(
                        "fact-patent-" + _citation_suffix(patent["patentId"]),
                        "representative_patent",
                        output_patent,
                        [patent_citation, company_patent_query_citation],
                        derived=False,
                    )
                )

            company_cpc_rows, company_cpc_evidence = _query(
                connection,
                query_id=f"company-cpc-{company_key}",
                statement=COMPANY_CPC_SQL,
                parameters=(company_id, domain_id),
            )
            evidence_list.append(company_cpc_evidence)
            company_cpc_groups = [
                {
                    "cpcGroup": row["cpc_group"],
                    "patentCount": row["patent_count"],
                }
                for row in company_cpc_rows[: spec["companyCpcGroupCount"]]
            ]
            companies.append(
                {
                    "rank": rank,
                    "companyId": company_id,
                    "preferredName": company["preferredName"],
                    "legalName": company["legalName"],
                    "country": company["country"],
                    "provider": company["provider"],
                    "patentCount": company["patentCount"],
                    "isAccepted": True,
                    "identityCitationId": company_citation,
                    "rankingCitationId": ranking_citation,
                    "matchCitationId": match_citation,
                    "aliases": aliases,
                    "externalIdentifiers": identifiers,
                    "matchEvidence": matches,
                    "topCpcGroups": company_cpc_groups,
                    "representativePatents": representative_patents,
                }
            )

    unavailable = inputs.silver_manifest.get("unavailableSourceFields", [])
    required_unavailable = set(spec["requiredUnavailableFields"])
    if not required_unavailable.issubset(unavailable):
        raise ReportError(
            "Silver manifest does not declare all required unavailable fields"
        )
    display_name = spec.get("domainDisplayNames", {}).get(
        domain_id, domain_row["name"]
    )
    report_data = {
        "schemaVersion": "1.0.0",
        "reportType": spec["reportType"],
        "reportId": f"minimal:{domain_id}:{version}",
        "version": version,
        "title": f"{display_name}最小带引用研究报告",
        "language": spec["language"],
        "generatedAt": generated_at,
        "catalogRelease": release,
        "queryVersion": spec["queryVersion"],
        "dataCutoff": f"{inputs.silver_manifest['period']['toYear']}-12-31",
        "domain": {
            "domainId": domain_row["domain_id"],
            "name": display_name,
            "catalogName": domain_row["name"],
            "ruleVersion": domain_row["rule_version"],
            "definition": domain_row["definition"],
        },
        "methodology": {
            "ruleVersion": domain_row["rule_version"],
            "queryVersion": spec["queryVersion"],
            "companyRanking": "distinct_patent_count_desc_company_id_asc",
            "representativePatentRanking": (
                "total_score_desc_patent_date_desc_patent_id_asc"
            ),
            "usesLlm": False,
            "usesThirdPartyRuntimeApi": False,
        },
        "metrics": {
            "patentCount": patent_count,
            "patentCountCitationId": patent_query_citation,
            "acceptedCandidateCount": accepted_count,
            "acceptedCandidateCitationId": accepted_citation,
            "pendingReviewCount": pending_count,
            "pendingReviewCitationId": review_citation,
            "rankedCompanyCount": len(companies),
            "sourcePairCount": len(source_pair_rows),
        },
        "yearTrend": year_trend,
        "topCpcGroups": top_cpc_groups,
        "companies": companies,
        "unavailableFields": unavailable,
        "limitations": [
            "领域判断只使用完整 CPC、标题关键词和排除词，没有摘要和权利要求正文。",
            "公司覆盖受 GLEIF、SEC 和人工审核进度限制。",
            "公司关系保留 GLEIF 原始关系类型，不统一解释为母子公司。",
            "专利计数仅代表当前美国授权专利和当前规则范围。",
            "当前没有新闻、论文、财务、产品和市场份额数据。",
        ],
        "facts": facts,
        "citations": sorted(citations.values(), key=lambda item: item["citationId"]),
        "queryEvidence": evidence_list,
    }
    report_data["quality"] = validate_report_data(report_data)
    if report_data["quality"]["keyFactCitationCoverage"] != 1.0:
        raise ReportError("Key fact citation coverage must be 100%")
    return json.loads(_canonical_json(report_data))


def _file_entry(path: Path) -> dict[str, Any]:
    return {
        "path": path.name,
        "sizeBytes": path.stat().st_size,
        "sha256": _sha256_file(path),
        "lineCount": len(path.read_text(encoding="utf-8").splitlines()),
    }


def _combined_sql_hash() -> str:
    normalized = {
        key: " ".join(value.split()) for key, value in sorted(QUERY_SQL.items())
    }
    return _content_sha256(normalized)


def _report_root(inputs: ReportInputs, domain_id: str, version: str) -> Path:
    data_root = Path(inputs.source_manifest["dataRoot"])
    return data_root / "reports" / domain_id.replace("_", "-") / version


def build_minimal_report(
    *,
    db_config: Path,
    release: str,
    domain_id: str,
    version: str,
    spec_path: Path | None = None,
    on_progress: Any = print,
) -> Path:
    """Build an immutable minimal research report release."""
    if not VERSION_PATTERN.fullmatch(version):
        raise ReportError(f"Invalid report version: {version}")
    if not DOMAIN_PATTERN.fullmatch(domain_id):
        raise ReportError(f"Invalid domain ID: {domain_id}")
    inputs = _load_inputs(db_config, release, spec_path)
    release_root = _report_root(inputs, domain_id, version)
    if release_root.exists():
        manifest_path = release_root / "manifest.json"
        on_progress(f"Report release already exists; verifying: {release_root}")
        verify_minimal_report(manifest_path=manifest_path, db_config=db_config)
        return manifest_path
    release_root.parent.mkdir(parents=True, exist_ok=True)
    temporary_root = release_root.parent / f".{version}.tmp-{uuid.uuid4().hex}"
    temporary_root.mkdir()
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    try:
        on_progress(f"Collecting Catalog report data: {domain_id}")
        report_data = _collect_report_data(
            db_config,
            inputs,
            domain_id=domain_id,
            version=version,
            generated_at=generated_at,
        )
        report_data_path = temporary_root / "report-data.json"
        report_path = temporary_root / "report.md"
        _write_json(report_data_path, report_data)
        report_path.write_text(
            render_markdown(report_data), encoding="utf-8", newline="\n"
        )
        files = [_file_entry(report_path), _file_entry(report_data_path)]
        manifest = {
            "schemaVersion": "1.0.0",
            "reportType": inputs.spec["reportType"],
            "queryVersion": inputs.spec["queryVersion"],
            "reportId": report_data["reportId"],
            "version": version,
            "domainId": domain_id,
            "status": "passed",
            "generatedAt": generated_at,
            "catalogRelease": release,
            "inputs": {
                key: {"path": str(inputs.paths[key]), "sha256": inputs.hashes[key]}
                for key in inputs.paths
            },
            "sqlSha256": _combined_sql_hash(),
            "parameters": {
                "topCompanyCount": inputs.spec["topCompanyCount"],
                "representativePatentCount": inputs.spec[
                    "representativePatentCount"
                ],
                "topCpcGroupCount": inputs.spec["topCpcGroupCount"],
            },
            "quality": {
                **report_data["quality"],
                "domainPatentCount": report_data["metrics"]["patentCount"],
                "rankedCompanyCount": len(report_data["companies"]),
                "sourcePairCount": report_data["metrics"]["sourcePairCount"],
            },
            "fileCount": len(files),
            "files": files,
        }
        _write_json(temporary_root / "manifest.json", manifest)
        temporary_root.rename(release_root)
    except Exception:
        if temporary_root.is_dir():
            shutil.rmtree(temporary_root)
        raise
    manifest_path = release_root / "manifest.json"
    on_progress(f"Built report release: {release_root}")
    verify_minimal_report(manifest_path=manifest_path, db_config=db_config)
    return manifest_path


def verify_minimal_report(*, manifest_path: Path, db_config: Path) -> dict[str, Any]:
    """Verify report artifacts, inputs, query results, and rendered Markdown."""
    manifest_path = manifest_path.resolve()
    manifest = _read_json(manifest_path)
    if manifest.get("status") != "passed":
        raise ReportError("Report release is not passed")
    if manifest.get("fileCount") != 2:
        raise ReportError("Report manifest fileCount must be 2")
    release_root = manifest_path.parent
    expected_paths = {"manifest.json"}
    for entry in manifest.get("files", []):
        relative = entry.get("path")
        if relative not in {"report.md", "report-data.json"}:
            raise ReportError(f"Unexpected report artifact: {relative}")
        path = release_root / relative
        expected_paths.add(relative)
        if not path.is_file():
            raise ReportError(f"Report artifact is missing: {relative}")
        if path.stat().st_size != entry.get("sizeBytes"):
            raise ReportError(f"Report artifact size mismatch: {relative}")
        if _sha256_file(path) != entry.get("sha256"):
            raise ReportError(f"Report artifact SHA-256 mismatch: {relative}")
        if len(path.read_text(encoding="utf-8").splitlines()) != entry.get(
            "lineCount"
        ):
            raise ReportError(f"Report artifact line count mismatch: {relative}")
    actual_paths = {
        path.relative_to(release_root).as_posix()
        for path in release_root.rglob("*")
        if path.is_file()
    }
    if actual_paths != expected_paths:
        raise ReportError(
            f"Report release file set mismatch: expected={sorted(expected_paths)}, "
            f"actual={sorted(actual_paths)}"
        )
    inputs_manifest = manifest.get("inputs") or {}
    for label, entry in inputs_manifest.items():
        path = Path(entry.get("path", ""))
        if not path.is_file() or _sha256_file(path) != entry.get("sha256"):
            raise ReportError(f"Recorded report input changed: {label}")
    spec_entry = inputs_manifest.get("spec") or {}
    inputs = _load_inputs(
        db_config,
        manifest["catalogRelease"],
        Path(spec_entry.get("path", "")),
    )
    for key, expected_hash in inputs.hashes.items():
        recorded = inputs_manifest.get(key) or {}
        if recorded.get("sha256") != expected_hash:
            raise ReportError(f"Report input hash differs from current input: {key}")
    if manifest.get("sqlSha256") != _combined_sql_hash():
        raise ReportError("Report SQL hash differs from current query version")
    report_data = _read_json(release_root / "report-data.json")
    quality = validate_report_data(report_data)
    for key, value in quality.items():
        if report_data.get("quality", {}).get(key) != value:
            raise ReportError(f"Report data quality metric mismatch: {key}")
    expected_data = _collect_report_data(
        db_config,
        inputs,
        domain_id=manifest["domainId"],
        version=manifest["version"],
        generated_at=manifest["generatedAt"],
    )
    if _canonical_json(report_data) != _canonical_json(expected_data):
        raise ReportError("Report data differs from current deterministic query result")
    expected_markdown = render_markdown(expected_data)
    actual_markdown = (release_root / "report.md").read_text(encoding="utf-8")
    if actual_markdown != expected_markdown:
        raise ReportError("Markdown report differs from deterministic template output")
    expected_quality = {
        **quality,
        "domainPatentCount": report_data["metrics"]["patentCount"],
        "rankedCompanyCount": len(report_data["companies"]),
        "sourcePairCount": report_data["metrics"]["sourcePairCount"],
    }
    if manifest.get("quality") != expected_quality:
        raise ReportError("Report manifest quality metrics are invalid")
    print(f"Verified minimal research report: {manifest['reportId']}")
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build")
    build.add_argument("--db-config", type=Path, required=True)
    build.add_argument("--release", required=True)
    build.add_argument("--domain", required=True)
    build.add_argument("--version", required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--db-config", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        if args.command == "build":
            build_minimal_report(
                db_config=args.db_config,
                release=args.release,
                domain_id=args.domain,
                version=args.version,
            )
        else:
            verify_minimal_report(
                manifest_path=args.manifest,
                db_config=args.db_config,
            )
    except (ReportError, psycopg.Error) as error:
        raise SystemExit(f"Report error: {error}") from error


if __name__ == "__main__":
    main()
