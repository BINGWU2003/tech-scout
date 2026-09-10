CREATE SCHEMA IF NOT EXISTS ingestion;
CREATE TABLE IF NOT EXISTS ingestion.event (
    sequence bigserial PRIMARY KEY,
    run_id uuid NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingestion_event_run_sequence ON ingestion.event(run_id, sequence);
CREATE SCHEMA IF NOT EXISTS catalog_v2;

CREATE TABLE IF NOT EXISTS ingestion.job (
    run_id uuid PRIMARY KEY,
    plan jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    progress jsonb NOT NULL DEFAULT '{}',
    error jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing jobs retain their original collection boundary; new jobs opt into gates.
ALTER TABLE ingestion.job ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'complete';
CREATE TABLE IF NOT EXISTS ingestion.item (
    run_id uuid NOT NULL REFERENCES ingestion.job(run_id),
    kind text NOT NULL,
    key text NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, kind, key)
);
CREATE TABLE IF NOT EXISTS ingestion.company_cache (
    query text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_v2.patent (
    publication_number text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_v2.company (
    company_id uuid PRIMARY KEY,
    credit_code text NOT NULL UNIQUE,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_v2.release (
    release_id uuid PRIMARY KEY REFERENCES ingestion.job(run_id),
    snapshot jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_v2.record_source (
    kind text NOT NULL,
    record_id text NOT NULL,
    run_id uuid NOT NULL REFERENCES ingestion.job(run_id),
    data jsonb NOT NULL,
    PRIMARY KEY(kind, record_id, run_id)
);
CREATE INDEX IF NOT EXISTS record_source_run_idx ON catalog_v2.record_source(run_id);
CREATE TABLE IF NOT EXISTS catalog_v2.run_projection (
    run_id uuid PRIMARY KEY REFERENCES ingestion.job(run_id),
    snapshot jsonb NOT NULL
);

-- Backfill observations from previously collected browser records only.
INSERT INTO catalog_v2.record_source(kind,record_id,run_id,data)
SELECT 'patent',key,run_id,jsonb_build_object(
  'source_url',data->'source_url','source_sha256',data->'source_sha256',
  'observed_at',data->'observed_at','domain_ids',data->'domain_ids')
FROM ingestion.item WHERE kind='patent' ON CONFLICT DO NOTHING;
INSERT INTO catalog_v2.record_source(kind,record_id,run_id,data)
SELECT 'company',co->>'company_id',run_id,jsonb_build_object(
  'source_url',co->'source_url','source_sha256',co->'source_sha256',
  'observed_at',co->'observed_at')
FROM ingestion.item CROSS JOIN LATERAL jsonb_array_elements(data->'companies') co
WHERE kind='company' ON CONFLICT DO NOTHING;
INSERT INTO catalog_v2.run_projection(run_id,snapshot)
SELECT release_id,snapshot FROM catalog_v2.release ON CONFLICT DO NOTHING;
