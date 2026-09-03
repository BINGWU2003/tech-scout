import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const migrations = [
  '../../../pipelines/data-foundation/migrations/001_catalog.sql',
  '../../../pipelines/data-foundation/migrations/002_review_audit.sql',
]

export async function resetCatalogFixture(connectionString: string) {
  const databaseName = new URL(connectionString).pathname.replace(/^\//, '')
  if (!databaseName.endsWith('_test')) {
    throw new Error('Catalog fixture database name must end with _test')
  }

  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS catalog CASCADE')
    await client.query('DROP SCHEMA IF EXISTS staging CASCADE')
    for (const relativePath of migrations) {
      const path = fileURLToPath(new URL(relativePath, import.meta.url))
      await client.query(await readFile(path, 'utf8'))
    }
    await client.query(FIXTURE_SQL)
  } finally {
    await client.end()
  }
}

const FIXTURE_SQL = `
INSERT INTO catalog.dataset_release (
  release_id, dataset, layer, release_status, source_status, publishable,
  generated_at, published_at, bronze_release, bronze_manifest, rules,
  review_file, period_from_year, period_to_year, unavailable_source_fields,
  manifest_path, manifest_sha256, file_count, total_rows, total_size_bytes,
  manifest
) VALUES
  (
    'test-v1', 'ai-domains', 'silver', 'published', 'complete', true,
    '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z', NULL, '{}', '{}', NULL,
    2019, 2025, '["abstract", "claim_text", "patent_family_id"]',
    'D:/private/project-data/silver/test-v1/manifest.json',
    repeat('a', 64), 1, 100, 1, '{}'
  ),
  (
    'test-v2', 'ai-domains', 'silver', 'draft', 'complete', false,
    '2026-09-02T00:00:00Z', NULL, NULL, '{}', '{}', NULL,
    2019, 2025, '[]', 'D:/private/draft/manifest.json',
    repeat('b', 64), 1, 1, 1, '{}'
  );

INSERT INTO catalog.domain (
  domain_id, name, rule_version, definition, first_seen_release, last_seen_release
) VALUES
  ('ai_chips_edge_inference', 'AI chips and edge inference', 'rules-v1',
   '{"includes":["neural accelerator"]}', 'test-v1', 'test-v1'),
  ('industrial_vision_quality_inspection',
   'Industrial vision and AI quality inspection', 'rules-v1',
   '{"includes":["machine vision"]}', 'test-v1', 'test-v1');

INSERT INTO catalog.patent_domain_evaluation (
  evaluation_id, patent_id, domain_id, patent_title, patent_date,
  matched_cpcs, matched_exact_cpc, matched_broad_cpc, matched_strong_title,
  matched_general_title, matched_strong_keywords, matched_general_keywords,
  matched_exclusion_keywords, cpc_score, title_score, total_score, decision,
  decision_reason, rule_version, first_seen_release, last_seen_release
) VALUES
  ('eval-1', 'patent-1', 'ai_chips_edge_inference', 'Edge neural accelerator',
   '2025-01-03', '["G06N3/063"]', true, true, true, false,
   '["neural accelerator"]', '[]', '[]', 4, 4, 8, 'included',
   'CPC and title matched', 'rules-v1', 'test-v1', 'test-v1'),
  ('eval-2', 'patent-2', 'ai_chips_edge_inference', 'Neural inference processor',
   '2024-05-10', '["G06N3/063"]', true, true, true, false,
   '["inference processor"]', '[]', '[]', 4, 4, 8, 'included',
   'CPC and title matched', 'rules-v1', 'test-v1', 'test-v1'),
  ('eval-3', 'patent-3', 'industrial_vision_quality_inspection',
   'Automated optical inspection system', '2023-06-20', '["G06V10/00"]',
   false, true, true, false, '["automated optical inspection"]', '[]', '[]',
   2, 4, 6, 'included', 'Title matched', 'rules-v1', 'test-v1', 'test-v1');

INSERT INTO catalog.patent (
  patent_id, patent_type, patent_date, grant_year, patent_title, wipo_kind,
  num_claims, withdrawn, filename, source_release, source_path, source_sha256,
  source_row_number, first_seen_release, last_seen_release
) VALUES
  ('patent-1', 'utility', '2025-01-03', 2025, 'Edge neural accelerator', 'B2',
   20, false, 'g_patent.tsv', 'source-v1', 'patents/g_patent.tsv', repeat('1',64),
   10, 'test-v1', 'test-v1'),
  ('patent-2', 'utility', '2024-05-10', 2024, 'Neural inference processor', 'B2',
   12, false, 'g_patent.tsv', 'source-v1', 'patents/g_patent.tsv', repeat('1',64),
   11, 'test-v1', 'test-v1'),
  ('patent-3', 'utility', '2023-06-20', 2023,
   'Automated optical inspection system', 'B2', 8, false, 'g_patent.tsv',
   'source-v1', 'patents/g_patent.tsv', repeat('1',64), 12,
   'test-v1', 'test-v1');

INSERT INTO catalog.patent_classification (
  classification_id, patent_id, cpc_group, source_release, source_path,
  source_sha256, source_row_number, first_seen_release, last_seen_release
) VALUES
  ('class-1', 'patent-1', 'G06N3/063', 'source-v1', 'patents/g_cpc.tsv',
   repeat('2',64), 20, 'test-v1', 'test-v1'),
  ('class-2', 'patent-2', 'G06N3/063', 'source-v1', 'patents/g_cpc.tsv',
   repeat('2',64), 21, 'test-v1', 'test-v1'),
  ('class-3', 'patent-3', 'G06V10/00', 'source-v1', 'patents/g_cpc.tsv',
   repeat('2',64), 22, 'test-v1', 'test-v1');

INSERT INTO catalog.patent_party (
  patent_party_id, patent_id, party_role, party_name, party_name_normalized,
  country, party_sequence, is_individual, source_release, source_path,
  source_sha256, source_row_number, first_seen_release, last_seen_release
) VALUES
  ('party-1', 'patent-1', 'assignee', 'Acme AI, Inc.', 'acme ai inc', 'US', 1,
   false, 'source-v1', 'patents/g_assignee.tsv', repeat('3',64), 30,
   'test-v1', 'test-v1'),
  ('party-2', 'patent-2', 'assignee', 'Acme AI', 'acme ai', 'US', 1, false,
   'source-v1', 'patents/g_assignee.tsv', repeat('3',64), 31,
   'test-v1', 'test-v1'),
  ('party-3', 'patent-3', 'assignee', 'Vision Works Ltd', 'vision works ltd',
   'GB', 1, false, 'source-v1', 'patents/g_assignee.tsv', repeat('3',64), 32,
   'test-v1', 'test-v1');

INSERT INTO catalog.patent_domain_match (
  domain_match_id, patent_id, domain_id, total_score, matched_cpcs,
  matched_strong_keywords, matched_general_keywords, rule_version,
  evaluation_id, first_seen_release, last_seen_release
) VALUES
  ('match-1', 'patent-1', 'ai_chips_edge_inference', 8, '["G06N3/063"]',
   '["neural accelerator"]', '[]', 'rules-v1', 'eval-1', 'test-v1', 'test-v1'),
  ('match-2', 'patent-2', 'ai_chips_edge_inference', 8, '["G06N3/063"]',
   '["inference processor"]', '[]', 'rules-v1', 'eval-2', 'test-v1', 'test-v1'),
  ('match-3', 'patent-3', 'industrial_vision_quality_inspection', 6,
   '["G06V10/00"]', '["automated optical inspection"]', '[]', 'rules-v1',
   'eval-3', 'test-v1', 'test-v1');

INSERT INTO catalog.company_candidate (
  candidate_id, representative_name, name_normalized, country, patent_count,
  party_row_count, raw_name_variant_count, first_patent_id, first_seen_release,
  last_seen_release
) VALUES
  ('candidate-1', 'Acme AI, Inc.', 'acme ai inc', 'US', 2, 2, 2, 'patent-1',
   'test-v1', 'test-v1'),
  ('candidate-2', 'Vision Works Ltd', 'vision works ltd', 'GB', 1, 1, 1,
   'patent-3', 'test-v1', 'test-v1'),
  ('candidate-3', 'Individual Inventor', 'individual inventor', 'US', 1, 1, 1,
   'patent-1', 'test-v1', 'test-v1');

INSERT INTO catalog.company_entity (
  company_id, preferred_name, country, legal_name, provider, entity_status,
  in_patent_scope, relationship_endpoint, source_release, source_path,
  source_sha256, source_row_number, first_seen_release, last_seen_release
) VALUES
  ('company-1', 'Acme AI', 'US', 'Acme AI, Inc.', 'GLEIF', 'ACTIVE', true,
   false, 'source-v1', 'companies/gleif.csv', repeat('4',64), 40,
   'test-v1', 'test-v1'),
  ('company-2', 'Vision Works', 'GB', 'Vision Works Ltd', 'GLEIF', 'ACTIVE',
   true, false, 'source-v1', 'companies/gleif.csv', repeat('4',64), 41,
   'test-v1', 'test-v1');

INSERT INTO catalog.company_alias (
  alias_id, company_id, alias_name, alias_normalized, alias_type,
  source_provider, source_release, source_path, source_sha256,
  source_row_number, first_seen_release, last_seen_release
) VALUES
  ('alias-1', 'company-1', 'Acme Artificial Intelligence',
   'acme artificial intelligence', 'other', 'GLEIF', 'source-v1',
   'companies/gleif.csv', repeat('4',64), 42, 'test-v1', 'test-v1');

INSERT INTO catalog.external_identifier (
  external_identifier_id, company_id, identifier_type, identifier_value,
  provider, metadata, source_release, source_path, source_sha256,
  source_row_number, first_seen_release, last_seen_release
) VALUES
  ('identifier-1', 'company-1', 'LEI', 'TESTLEI000000000001', 'GLEIF', NULL,
   'source-v1', 'companies/gleif.csv', repeat('4',64), 43,
   'test-v1', 'test-v1');

INSERT INTO catalog.entity_match (
  entity_match_id, candidate_id, suggested_company_id, provider,
  provider_identifier, suggested_name, candidate_country, suggested_country,
  match_method, similarity_score, suggestion_rank, decision, decision_reason,
  is_accepted, reviewer, reviewer_note, rule_version, first_seen_release,
  last_seen_release
) VALUES
  ('entity-match-1', 'candidate-1', 'company-1', 'GLEIF',
   'TESTLEI000000000001', 'Acme AI, Inc.', 'US', 'US', 'unique_legal_name',
   0.99, 1, 'accepted', 'Legal name and country matched', true, 'fixture', NULL,
   'rules-v1', 'test-v1', 'test-v1'),
  ('entity-match-2', 'candidate-2', 'company-2', 'GLEIF', NULL,
   'Vision Works Ltd', 'GB', 'GB', 'human_selected', NULL, 1, 'accepted',
   'Official evidence matched', true, 'fixture', NULL, 'rules-v1',
   'test-v1', 'test-v1'),
  ('entity-match-3', 'candidate-3', 'company-1', 'GLEIF', NULL, 'Acme AI',
   'US', 'US', 'name_similarity', 0.4, 1, 'rejected', 'Entity is an individual',
   false, 'fixture', NULL, 'rules-v1', 'test-v1', 'test-v1');

INSERT INTO catalog.company_patent_relation (
  company_patent_relation_id, company_id, patent_id, patent_party_id,
  candidate_id, match_method, entity_match_decision, first_seen_release,
  last_seen_release
) VALUES
  ('company-patent-1', 'company-1', 'patent-1', 'party-1', 'candidate-1',
   'unique_legal_name', 'accepted', 'test-v1', 'test-v1'),
  ('company-patent-2', 'company-1', 'patent-2', 'party-2', 'candidate-1',
   'unique_legal_name', 'accepted', 'test-v1', 'test-v1'),
  ('company-patent-3', 'company-2', 'patent-3', 'party-3', 'candidate-2',
   'human_selected', 'accepted', 'test-v1', 'test-v1');

INSERT INTO catalog.company_relation (
  company_relation_id, start_company_id, end_company_id, relationship_type,
  relationship_status, period_start_date, period_end_date, period_type,
  source_release, source_path, source_sha256, source_row_number,
  first_seen_release, last_seen_release
) VALUES
  ('relation-1', 'company-1', 'company-2', 'IS_DIRECTLY_CONSOLIDATED_BY',
   'ACTIVE', '2020-01-01', NULL, 'OPEN', 'source-v1',
   'relationships/gleif.csv', repeat('5',64), 50, 'test-v1', 'test-v1');

INSERT INTO catalog.entity_review_decision (
  candidate_id, decision, organization_type, selected_company_id,
  review_method, reviewed_at, evidence_ids, reviewer, reviewer_note,
  source_release, source_path, source_sha256, source_row_number,
  first_seen_release, last_seen_release
) VALUES
  ('candidate-3', 'rejected', 'individual', NULL, 'evidence_rule',
   '2026-08-30T00:00:00Z', '["evidence-2"]', 'fixture',
   'Confirmed as individual', 'review-v1',
   'D:/private/project-data/reviews/test/decisions.csv', repeat('6',64), 60,
   'test-v1', 'test-v1');

INSERT INTO catalog.entity_evidence (
  evidence_id, candidate_id, publisher, source_type, source_url, observed_at,
  legal_name, country, identifier_type, identifier_value, preserved,
  content_sha256, source_release, source_path, source_sha256,
  source_row_number, first_seen_release, last_seen_release
) VALUES
  ('evidence-1', 'candidate-1', 'GLEIF', 'official_registry',
   'https://example.test/acme', '2026-08-30T00:00:00Z', 'Acme AI, Inc.', 'US',
   'LEI', 'TESTLEI000000000001', false, NULL, 'review-v1',
   'D:/private/project-data/reviews/test/evidence.jsonl', repeat('7',64), 70,
   'test-v1', 'test-v1'),
  ('evidence-2', 'candidate-3', 'USPTO', 'official_record',
   'https://example.test/individual', '2026-08-30T00:00:00Z', NULL, 'US',
   NULL, NULL, false, NULL, 'review-v1',
   'D:/private/project-data/reviews/test/evidence.jsonl', repeat('7',64), 71,
   'test-v1', 'test-v1');

INSERT INTO catalog.dataset_record (release_id, entity_type, entity_id) VALUES
  ('test-v1', 'domains', 'ai_chips_edge_inference'),
  ('test-v1', 'domains', 'industrial_vision_quality_inspection'),
  ('test-v1', 'patent-domain-evaluations', 'eval-1'),
  ('test-v1', 'patent-domain-evaluations', 'eval-2'),
  ('test-v1', 'patent-domain-evaluations', 'eval-3'),
  ('test-v1', 'patents', 'patent-1'),
  ('test-v1', 'patents', 'patent-2'),
  ('test-v1', 'patents', 'patent-3'),
  ('test-v1', 'patent-classifications', 'class-1'),
  ('test-v1', 'patent-classifications', 'class-2'),
  ('test-v1', 'patent-classifications', 'class-3'),
  ('test-v1', 'patent-parties', 'party-1'),
  ('test-v1', 'patent-parties', 'party-2'),
  ('test-v1', 'patent-parties', 'party-3'),
  ('test-v1', 'patent-domain-matches', 'match-1'),
  ('test-v1', 'patent-domain-matches', 'match-2'),
  ('test-v1', 'patent-domain-matches', 'match-3'),
  ('test-v1', 'company-candidates', 'candidate-1'),
  ('test-v1', 'company-candidates', 'candidate-2'),
  ('test-v1', 'company-candidates', 'candidate-3'),
  ('test-v1', 'companies', 'company-1'),
  ('test-v1', 'companies', 'company-2'),
  ('test-v1', 'company-aliases', 'alias-1'),
  ('test-v1', 'external-identifiers', 'identifier-1'),
  ('test-v1', 'entity-matches', 'entity-match-1'),
  ('test-v1', 'entity-matches', 'entity-match-2'),
  ('test-v1', 'entity-matches', 'entity-match-3'),
  ('test-v1', 'company-patent-relations', 'company-patent-1'),
  ('test-v1', 'company-patent-relations', 'company-patent-2'),
  ('test-v1', 'company-patent-relations', 'company-patent-3'),
  ('test-v1', 'company-relations', 'relation-1'),
  ('test-v1', 'entity-review-decisions', 'candidate-3'),
  ('test-v1', 'entity-evidence', 'evidence-1'),
  ('test-v1', 'entity-evidence', 'evidence-2');
`
