CREATE TABLE IF NOT EXISTS workflow_definitions (
  id text NOT NULL, version text NOT NULL, enabled boolean NOT NULL, record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS workflow_executions (
  id text PRIMARY KEY, status text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','REJECTED','MANUAL_REVIEW')),
  request_hash text NOT NULL, record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
