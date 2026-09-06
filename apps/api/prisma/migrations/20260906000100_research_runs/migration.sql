CREATE TABLE app.research_project (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app.user_account(id) ON DELETE CASCADE,
    title varchar(200) NOT NULL,
    question text NOT NULL,
    request_key uuid NOT NULL,
    created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX research_project_user_id_request_key_key
    ON app.research_project(user_id, request_key);
CREATE INDEX research_project_user_id_created_at_idx
    ON app.research_project(user_id, created_at);
CREATE TABLE app.research_run (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES app.research_project(id) ON DELETE CASCADE,
    request_key uuid NOT NULL,
    question text NOT NULL,
    status varchar(40) NOT NULL DEFAULT 'queued',
    sequence integer NOT NULL DEFAULT 0,
    state jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz(3) NOT NULL
);
CREATE UNIQUE INDEX research_run_project_id_request_key_key
    ON app.research_run(project_id, request_key);
CREATE INDEX research_run_status_updated_at_idx ON app.research_run(status, updated_at);
CREATE TABLE app.research_event (
    run_id uuid NOT NULL REFERENCES app.research_run(id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    kind varchar(60) NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz(3) NOT NULL,
    PRIMARY KEY(run_id, sequence)
);
CREATE TABLE app.research_command (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES app.research_run(id) ON DELETE CASCADE,
    payload jsonb NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    error jsonb,
    created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX research_command_status_created_at_idx ON app.research_command(status, created_at);
