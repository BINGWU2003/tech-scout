CREATE SCHEMA IF NOT EXISTS ingestion;
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
