import json
import subprocess
import sys
from pathlib import Path

import pytest

from data_foundation.reports.minimal import (
    ReportError,
    render_markdown,
    resolve_source_record,
    select_company_aliases,
    select_representative_patents,
    select_top_companies,
    validate_report_data,
    verify_minimal_report,
)


def test_report_cli_exposes_build_and_verify_commands() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "data_foundation.reports.minimal", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "build" in result.stdout
    assert "verify" in result.stdout


def test_top_companies_are_accepted_and_stably_ranked() -> None:
    companies = [
        {
            "companyId": "company:c",
            "preferredName": "未接受公司",
            "patentCount": 99,
            "isAccepted": False,
        },
        {
            "companyId": "company:b",
            "preferredName": "삼성디스플레이(주)",
            "patentCount": 12,
            "isAccepted": True,
        },
        {
            "companyId": "company:a",
            "preferredName": "Alpha",
            "patentCount": 12,
            "isAccepted": True,
        },
    ]

    selected = select_top_companies(companies, limit=2)

    assert [company["companyId"] for company in selected] == [
        "company:a",
        "company:b",
    ]
    assert selected[1]["preferredName"] == "삼성디스플레이(주)"


def test_representative_patents_are_deduplicated_and_stably_ranked() -> None:
    patents = [
        {"patentId": "p2", "totalScore": 8, "patentDate": "2025-01-02"},
        {"patentId": "p1", "totalScore": 8, "patentDate": "2025-01-02"},
        {"patentId": "p3", "totalScore": 10, "patentDate": "2024-01-01"},
        {"patentId": "p3", "totalScore": 10, "patentDate": "2024-01-01"},
        {"patentId": "p4", "totalScore": 6, "patentDate": "2025-12-31"},
    ]

    selected = select_representative_patents(patents, limit=3)

    assert [patent["patentId"] for patent in selected] == ["p3", "p1", "p2"]


def test_source_resolution_preserves_unknown_download_time() -> None:
    source_manifest = {
        "files": [
            {
                "path": "patents/g_patent.tsv",
                "sha256": "a" * 64,
                "provider": "USPTO",
                "dataset": "uspto-pvgpatdis",
                "sourceUrl": "https://example.test/uspto",
                "downloadedAt": None,
                "observedMtimeUtc": "2026-09-01T00:00:00Z",
                "license": {"status": "not_recorded"},
            }
        ]
    }

    resolved = resolve_source_record(
        source_manifest,
        source_path="patents/g_patent.tsv",
        source_sha256="a" * 64,
        source_row_number=12,
    )

    assert resolved["downloadedAt"] is None
    assert resolved["observedMtimeUtc"] == "2026-09-01T00:00:00Z"
    assert resolved["sourceRowNumber"] == 12

    with pytest.raises(ReportError, match="positive"):
        resolve_source_record(
            source_manifest,
            source_path="patents/g_patent.tsv",
            source_sha256="a" * 64,
            source_row_number=0,
        )

    with pytest.raises(ReportError, match="not registered"):
        resolve_source_record(
            source_manifest,
            source_path="patents/g_patent.tsv",
            source_sha256="b" * 64,
            source_row_number=12,
        )


def test_report_data_requires_citations_for_every_key_fact() -> None:
    report_data = {
        "facts": [
            {"factId": "fact-1", "isKeyFact": True, "citationIds": ["cit-1"]},
            {"factId": "fact-2", "isKeyFact": True, "citationIds": []},
        ],
        "citations": [{"citationId": "cit-1"}],
        "unavailableFields": ["abstract", "claim_text", "patent_family_id"],
    }

    with pytest.raises(ReportError, match="fact-2"):
        validate_report_data(report_data)

    report_data["facts"][1]["citationIds"] = ["cit-1"]
    quality = validate_report_data(report_data)

    assert quality["keyFactCitationCoverage"] == 1.0
    assert quality["keyFactCount"] == 2


def test_markdown_uses_fixed_chinese_sections_and_preserves_source_names() -> None:
    report_data = {
        "title": "AI 芯片与边缘推理最小研究报告",
        "generatedAt": "2026-09-02T00:00:00Z",
        "catalogRelease": "2026-09-v2",
        "queryVersion": "minimal-domain-research-v1",
        "dataCutoff": "2025-12-31",
        "domain": {"domainId": "ai_chips_edge_inference", "name": "AI 芯片"},
        "methodology": {"ruleVersion": "ai-domains-v1"},
        "metrics": {
            "patentCount": 1,
            "acceptedCandidateCount": 1,
            "pendingReviewCount": 0,
        },
        "yearTrend": [{"year": 2025, "patentCount": 1}],
        "topCpcGroups": [{"cpcGroup": "G06N3/063", "patentCount": 1}],
        "companies": [
            {
                "rank": 1,
                "companyId": "company:1",
                "preferredName": "삼성디스플레이(주)",
                "country": "KR",
                "patentCount": 1,
                "matchEvidence": [{"decision": "auto_accepted"}],
                "representativePatents": [
                    {
                        "patentId": "123",
                        "patentTitle": "Neural accelerator",
                        "patentDate": "2025-01-01",
                        "totalScore": 8,
                        "citationId": "cit-patent-1",
                    }
                ],
            }
        ],
        "unavailableFields": ["abstract"],
        "limitations": ["不代表市场份额。"],
        "citations": [
            {
                "citationId": "cit-patent-1",
                "citationType": "source_record",
                "provider": "USPTO",
                "sourceUrl": "https://example.test",
                "locator": "patents/g_patent.tsv:12",
                "excerpt": "Neural accelerator",
            }
        ],
        "queryEvidence": [],
    }

    markdown = render_markdown(report_data)

    assert "## 1. 研究问题、范围与数据版本" in markdown
    assert "## 4. 重点公司长名单" in markdown
    assert "## 8. 完整引用与执行记录" in markdown
    assert "삼성디스플레이(주)" in markdown
    assert "[cit-patent-1]" in markdown


def test_company_aliases_exclude_primary_name_and_duplicates() -> None:
    aliases = [
        {"aliasId": "1", "aliasName": "主名称", "aliasType": "legal"},
        {"aliasId": "2", "aliasName": "English Name", "aliasType": "other"},
        {"aliasId": "3", "aliasName": "English Name", "aliasType": "translated"},
        {"aliasId": "4", "aliasName": "Second Name", "aliasType": "other"},
    ]

    selected = select_company_aliases(aliases, primary_name="主名称", limit=5)

    assert [alias["aliasName"] for alias in selected] == [
        "English Name",
        "Second Name",
    ]


def test_verify_rejects_a_tampered_report_before_database_access(
    tmp_path: Path,
) -> None:
    (tmp_path / "report.md").write_text("changed", encoding="utf-8")
    (tmp_path / "report-data.json").write_text("{}", encoding="utf-8")
    manifest = {
        "status": "passed",
        "fileCount": 2,
        "files": [
            {
                "path": "report.md",
                "sizeBytes": 999,
                "sha256": "0" * 64,
                "lineCount": 1,
            },
            {
                "path": "report-data.json",
                "sizeBytes": 2,
                "sha256": "0" * 64,
                "lineCount": 1,
            },
        ],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ReportError, match="size mismatch"):
        verify_minimal_report(
            manifest_path=manifest_path,
            db_config=tmp_path / "missing-db.txt",
        )
