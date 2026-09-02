CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS catalog.schema_migration (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.dataset_release (
    release_id text PRIMARY KEY,
    dataset text NOT NULL,
    layer text NOT NULL,
    release_status text NOT NULL,
    source_status text NOT NULL,
    publishable boolean NOT NULL,
    generated_at timestamptz NOT NULL,
    published_at timestamptz,
    bronze_release text,
    bronze_manifest jsonb NOT NULL,
    rules jsonb NOT NULL,
    review_file jsonb,
    period_from_year smallint NOT NULL,
    period_to_year smallint NOT NULL,
    unavailable_source_fields jsonb NOT NULL,
    manifest_path text NOT NULL,
    manifest_sha256 char(64) NOT NULL,
    file_count integer NOT NULL CHECK (file_count > 0),
    total_rows bigint NOT NULL CHECK (total_rows >= 0),
    total_size_bytes bigint NOT NULL CHECK (total_size_bytes > 0),
    manifest jsonb NOT NULL,
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS catalog.source_file (
    source_file_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    release_id text NOT NULL REFERENCES catalog.dataset_release(release_id),
    dataset text NOT NULL,
    relative_path text NOT NULL,
    file_format text NOT NULL,
    row_count bigint NOT NULL CHECK (row_count >= 0),
    column_count integer NOT NULL CHECK (column_count >= 0),
    schema_json jsonb NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    UNIQUE (release_id, relative_path)
);

CREATE TABLE IF NOT EXISTS catalog.import_job (
    import_job_id uuid PRIMARY KEY,
    release_id text NOT NULL REFERENCES catalog.dataset_release(release_id),
    status text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    imported_rows bigint NOT NULL DEFAULT 0,
    table_counts jsonb,
    error_message text
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.patent_domain_evaluation (
    import_job_id uuid NOT NULL,
    evaluation_id text NOT NULL,
    patent_id text NOT NULL,
    domain_id text NOT NULL,
    patent_title text NOT NULL,
    patent_date date,
    matched_cpcs jsonb NOT NULL,
    matched_exact_cpc boolean NOT NULL,
    matched_broad_cpc boolean NOT NULL,
    matched_strong_title boolean NOT NULL,
    matched_general_title boolean NOT NULL,
    matched_strong_keywords jsonb NOT NULL,
    matched_general_keywords jsonb NOT NULL,
    matched_exclusion_keywords jsonb NOT NULL,
    cpc_score integer NOT NULL,
    title_score integer NOT NULL,
    total_score integer NOT NULL,
    decision text NOT NULL,
    decision_reason text NOT NULL,
    rule_version text NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.patent (
    import_job_id uuid NOT NULL,
    patent_id text NOT NULL,
    patent_type text,
    patent_date date NOT NULL,
    grant_year smallint NOT NULL,
    patent_title text NOT NULL,
    wipo_kind text,
    num_claims integer,
    withdrawn boolean,
    filename text,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.patent_classification (
    import_job_id uuid NOT NULL,
    classification_id text NOT NULL,
    patent_id text NOT NULL,
    cpc_sequence integer,
    cpc_version_indicator text,
    cpc_section text,
    cpc_class text,
    cpc_subclass text,
    cpc_group text NOT NULL,
    cpc_type text,
    cpc_action_date date,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.patent_party (
    import_job_id uuid NOT NULL,
    patent_party_id text NOT NULL,
    patent_id text NOT NULL,
    party_role text NOT NULL,
    party_name text NOT NULL,
    party_name_normalized text NOT NULL,
    country text,
    city text,
    region text,
    party_sequence integer,
    is_individual boolean NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.patent_domain_match (
    import_job_id uuid NOT NULL,
    domain_match_id text NOT NULL,
    patent_id text NOT NULL,
    domain_id text NOT NULL,
    total_score integer NOT NULL,
    matched_cpcs jsonb NOT NULL,
    matched_strong_keywords jsonb NOT NULL,
    matched_general_keywords jsonb NOT NULL,
    rule_version text NOT NULL,
    evaluation_id text NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.company_candidate (
    import_job_id uuid NOT NULL,
    candidate_id text NOT NULL,
    representative_name text NOT NULL,
    name_normalized text NOT NULL,
    country text,
    patent_count bigint NOT NULL,
    party_row_count bigint NOT NULL,
    raw_name_variant_count integer NOT NULL,
    first_patent_id text NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.entity_match (
    import_job_id uuid NOT NULL,
    entity_match_id text NOT NULL,
    candidate_id text NOT NULL,
    suggested_company_id text,
    provider text,
    provider_identifier text,
    suggested_name text,
    candidate_country text,
    suggested_country text,
    match_method text NOT NULL,
    similarity_score double precision,
    suggestion_rank integer NOT NULL,
    decision text NOT NULL,
    decision_reason text NOT NULL,
    is_accepted boolean NOT NULL,
    reviewer text,
    reviewer_note text,
    rule_version text NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.company_entity (
    import_job_id uuid NOT NULL,
    company_id text NOT NULL,
    preferred_name text NOT NULL,
    country text,
    legal_name text,
    provider text NOT NULL,
    entity_status text,
    in_patent_scope boolean NOT NULL,
    relationship_endpoint boolean NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.company_alias (
    import_job_id uuid NOT NULL,
    alias_id text NOT NULL,
    company_id text NOT NULL,
    alias_name text NOT NULL,
    alias_normalized text NOT NULL,
    alias_type text NOT NULL,
    source_provider text NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.external_identifier (
    import_job_id uuid NOT NULL,
    external_identifier_id text NOT NULL,
    company_id text NOT NULL,
    identifier_type text NOT NULL,
    identifier_value text NOT NULL,
    provider text NOT NULL,
    metadata jsonb,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.company_relation (
    import_job_id uuid NOT NULL,
    company_relation_id text NOT NULL,
    start_company_id text NOT NULL,
    end_company_id text NOT NULL,
    relationship_type text NOT NULL,
    relationship_status text,
    period_start_date date,
    period_end_date date,
    period_type text,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.company_patent_relation (
    import_job_id uuid NOT NULL,
    company_patent_relation_id text NOT NULL,
    company_id text NOT NULL,
    patent_id text NOT NULL,
    patent_party_id text NOT NULL,
    candidate_id text NOT NULL,
    match_method text NOT NULL,
    entity_match_decision text NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.entity_review (
    import_job_id uuid NOT NULL,
    candidate_id text NOT NULL,
    assignee_name text NOT NULL,
    name_normalized text NOT NULL,
    country text,
    patent_count bigint NOT NULL,
    party_row_count bigint NOT NULL,
    status text NOT NULL,
    best_match_method text,
    best_confidence double precision,
    best_candidate_company_id text,
    best_candidate_name text,
    suggestions_json jsonb NOT NULL,
    decision text,
    selected_company_id text,
    reviewer text,
    reviewer_note text
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.domain (
    import_job_id uuid NOT NULL,
    domain_id text NOT NULL,
    name text NOT NULL,
    rule_version text NOT NULL,
    definition jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog.domain (
    domain_id text PRIMARY KEY,
    name text NOT NULL,
    rule_version text NOT NULL,
    definition jsonb NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.patent_domain_evaluation (
    evaluation_id text PRIMARY KEY,
    patent_id text NOT NULL,
    domain_id text NOT NULL,
    patent_title text NOT NULL,
    patent_date date,
    matched_cpcs jsonb NOT NULL,
    matched_exact_cpc boolean NOT NULL,
    matched_broad_cpc boolean NOT NULL,
    matched_strong_title boolean NOT NULL,
    matched_general_title boolean NOT NULL,
    matched_strong_keywords jsonb NOT NULL,
    matched_general_keywords jsonb NOT NULL,
    matched_exclusion_keywords jsonb NOT NULL,
    cpc_score integer NOT NULL,
    title_score integer NOT NULL,
    total_score integer NOT NULL,
    decision text NOT NULL,
    decision_reason text NOT NULL,
    rule_version text NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.patent (
    patent_id text PRIMARY KEY,
    patent_type text,
    patent_date date NOT NULL,
    grant_year smallint NOT NULL,
    patent_title text NOT NULL,
    wipo_kind text,
    num_claims integer,
    withdrawn boolean,
    filename text,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.patent_classification (
    classification_id text PRIMARY KEY,
    patent_id text NOT NULL REFERENCES catalog.patent(patent_id),
    cpc_sequence integer,
    cpc_version_indicator text,
    cpc_section text,
    cpc_class text,
    cpc_subclass text,
    cpc_group text NOT NULL,
    cpc_type text,
    cpc_action_date date,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.patent_party (
    patent_party_id text PRIMARY KEY,
    patent_id text NOT NULL REFERENCES catalog.patent(patent_id),
    party_role text NOT NULL,
    party_name text NOT NULL,
    party_name_normalized text NOT NULL,
    country text,
    city text,
    region text,
    party_sequence integer,
    is_individual boolean NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.company_candidate (
    candidate_id text PRIMARY KEY,
    representative_name text NOT NULL,
    name_normalized text NOT NULL,
    country text,
    patent_count bigint NOT NULL,
    party_row_count bigint NOT NULL,
    raw_name_variant_count integer NOT NULL,
    first_patent_id text NOT NULL REFERENCES catalog.patent(patent_id),
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.company_entity (
    company_id text PRIMARY KEY,
    preferred_name text NOT NULL,
    country text,
    legal_name text,
    provider text NOT NULL,
    entity_status text,
    in_patent_scope boolean NOT NULL,
    relationship_endpoint boolean NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.entity_match (
    entity_match_id text PRIMARY KEY,
    candidate_id text NOT NULL REFERENCES catalog.company_candidate(candidate_id),
    suggested_company_id text,
    provider text,
    provider_identifier text,
    suggested_name text,
    candidate_country text,
    suggested_country text,
    match_method text NOT NULL,
    similarity_score double precision,
    suggestion_rank integer NOT NULL,
    decision text NOT NULL,
    decision_reason text NOT NULL,
    is_accepted boolean NOT NULL,
    reviewer text,
    reviewer_note text,
    rule_version text NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.company_alias (
    alias_id text PRIMARY KEY,
    company_id text NOT NULL REFERENCES catalog.company_entity(company_id),
    alias_name text NOT NULL,
    alias_normalized text NOT NULL,
    alias_type text NOT NULL,
    source_provider text NOT NULL,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.external_identifier (
    external_identifier_id text PRIMARY KEY,
    company_id text NOT NULL REFERENCES catalog.company_entity(company_id),
    identifier_type text NOT NULL,
    identifier_value text NOT NULL,
    provider text NOT NULL,
    metadata jsonb,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    UNIQUE (identifier_type, identifier_value, provider)
);

CREATE TABLE IF NOT EXISTS catalog.company_relation (
    company_relation_id text PRIMARY KEY,
    start_company_id text NOT NULL REFERENCES catalog.company_entity(company_id),
    end_company_id text NOT NULL REFERENCES catalog.company_entity(company_id),
    relationship_type text NOT NULL,
    relationship_status text,
    period_start_date date,
    period_end_date date,
    period_type text,
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.patent_domain_match (
    domain_match_id text PRIMARY KEY,
    patent_id text NOT NULL REFERENCES catalog.patent(patent_id),
    domain_id text NOT NULL REFERENCES catalog.domain(domain_id),
    total_score integer NOT NULL,
    matched_cpcs jsonb NOT NULL,
    matched_strong_keywords jsonb NOT NULL,
    matched_general_keywords jsonb NOT NULL,
    rule_version text NOT NULL,
    evaluation_id text NOT NULL REFERENCES catalog.patent_domain_evaluation(evaluation_id),
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    UNIQUE (patent_id, domain_id, rule_version)
);

CREATE TABLE IF NOT EXISTS catalog.company_patent_relation (
    company_patent_relation_id text PRIMARY KEY,
    company_id text NOT NULL REFERENCES catalog.company_entity(company_id),
    patent_id text NOT NULL REFERENCES catalog.patent(patent_id),
    patent_party_id text NOT NULL REFERENCES catalog.patent_party(patent_party_id),
    candidate_id text NOT NULL REFERENCES catalog.company_candidate(candidate_id),
    match_method text NOT NULL,
    entity_match_decision text NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    UNIQUE (company_id, patent_id, patent_party_id)
);

CREATE TABLE IF NOT EXISTS catalog.entity_review (
    release_id text NOT NULL REFERENCES catalog.dataset_release(release_id),
    candidate_id text NOT NULL REFERENCES catalog.company_candidate(candidate_id),
    assignee_name text NOT NULL,
    name_normalized text NOT NULL,
    country text,
    patent_count bigint NOT NULL,
    party_row_count bigint NOT NULL,
    status text NOT NULL,
    best_match_method text,
    best_confidence double precision,
    best_candidate_company_id text,
    best_candidate_name text,
    suggestions_json jsonb NOT NULL,
    decision text,
    selected_company_id text,
    reviewer text,
    reviewer_note text,
    PRIMARY KEY (release_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS catalog.dataset_record (
    release_id text NOT NULL REFERENCES catalog.dataset_release(release_id),
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    PRIMARY KEY (release_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS patent_date_idx
    ON catalog.patent (patent_date);
CREATE INDEX IF NOT EXISTS patent_title_fts_idx
    ON catalog.patent USING gin (to_tsvector('simple', patent_title));
CREATE INDEX IF NOT EXISTS patent_classification_cpc_idx
    ON catalog.patent_classification (cpc_group);
CREATE INDEX IF NOT EXISTS patent_classification_patent_idx
    ON catalog.patent_classification (patent_id);
CREATE INDEX IF NOT EXISTS patent_party_name_idx
    ON catalog.patent_party (party_name_normalized);
CREATE INDEX IF NOT EXISTS patent_party_patent_idx
    ON catalog.patent_party (patent_id);
CREATE INDEX IF NOT EXISTS company_name_idx
    ON catalog.company_entity (lower(preferred_name));
CREATE INDEX IF NOT EXISTS company_alias_name_idx
    ON catalog.company_alias (alias_normalized);
CREATE INDEX IF NOT EXISTS entity_match_candidate_idx
    ON catalog.entity_match (candidate_id, is_accepted);
CREATE INDEX IF NOT EXISTS patent_domain_match_domain_idx
    ON catalog.patent_domain_match (domain_id, total_score DESC);
CREATE INDEX IF NOT EXISTS company_patent_company_idx
    ON catalog.company_patent_relation (company_id, patent_id);
CREATE INDEX IF NOT EXISTS company_patent_patent_idx
    ON catalog.company_patent_relation (patent_id, company_id);
CREATE INDEX IF NOT EXISTS domain_evaluation_decision_idx
    ON catalog.patent_domain_evaluation (domain_id, decision);

ALTER TABLE staging.external_identifier
    ALTER COLUMN metadata DROP NOT NULL;
ALTER TABLE catalog.external_identifier
    ALTER COLUMN metadata DROP NOT NULL;

INSERT INTO catalog.schema_migration (version)
VALUES ('001_catalog')
ON CONFLICT (version) DO NOTHING;
