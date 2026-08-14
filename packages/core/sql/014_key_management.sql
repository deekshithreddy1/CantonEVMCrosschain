CREATE TABLE IF NOT EXISTS signing_requests (id text PRIMARY KEY, organization_id text NOT NULL, project_id text NOT NULL, environment_id text NOT NULL, record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS signing_approvals (id text PRIMARY KEY, request_id text NOT NULL REFERENCES signing_requests(id), approver_id text NOT NULL, record jsonb NOT NULL, UNIQUE(request_id,approver_id));
CREATE TABLE IF NOT EXISTS signing_results (request_id text PRIMARY KEY REFERENCES signing_requests(id), record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- These tables intentionally contain key references, digests, policy, approvals, and signature evidence only. Private key material is prohibited.
