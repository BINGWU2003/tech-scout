CREATE UNLOGGED TABLE IF NOT EXISTS staging.entity_review_decision (
    import_job_id uuid NOT NULL,
    candidate_id text NOT NULL,
    decision text NOT NULL,
    organization_type text NOT NULL,
    selected_company_id text,
    review_method text NOT NULL,
    reviewed_at timestamptz,
    evidence_ids jsonb NOT NULL,
    reviewer text,
    reviewer_note text,
    source_release text,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS staging.entity_evidence (
    import_job_id uuid NOT NULL,
    evidence_id text NOT NULL,
    candidate_id text NOT NULL,
    publisher text NOT NULL,
    source_type text NOT NULL,
    source_url text NOT NULL,
    observed_at timestamptz NOT NULL,
    legal_name text,
    country text,
    identifier_type text,
    identifier_value text,
    preserved boolean NOT NULL,
    content_sha256 char(64),
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL,
    source_row_number bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog.entity_review_decision (
    candidate_id text PRIMARY KEY REFERENCES catalog.company_candidate(candidate_id),
    decision text NOT NULL,
    organization_type text NOT NULL,
    selected_company_id text REFERENCES catalog.company_entity(company_id),
    review_method text NOT NULL,
    reviewed_at timestamptz,
    evidence_ids jsonb NOT NULL,
    reviewer text,
    reviewer_note text,
    source_release text,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id)
);

CREATE TABLE IF NOT EXISTS catalog.entity_evidence (
    evidence_id text PRIMARY KEY,
    candidate_id text NOT NULL REFERENCES catalog.company_candidate(candidate_id),
    publisher text NOT NULL,
    source_type text NOT NULL,
    source_url text NOT NULL,
    observed_at timestamptz NOT NULL,
    legal_name text,
    country text,
    identifier_type text,
    identifier_value text,
    preserved boolean NOT NULL,
    content_sha256 char(64),
    source_release text NOT NULL,
    source_path text NOT NULL,
    source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_row_number bigint NOT NULL,
    first_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    last_seen_release text NOT NULL REFERENCES catalog.dataset_release(release_id),
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS entity_review_decision_status_idx
    ON catalog.entity_review_decision (decision, organization_type);
CREATE INDEX IF NOT EXISTS entity_evidence_candidate_idx
    ON catalog.entity_evidence (candidate_id, source_type);

INSERT INTO catalog.schema_migration (version)
VALUES ('002_review_audit')
ON CONFLICT (version) DO NOTHING;
