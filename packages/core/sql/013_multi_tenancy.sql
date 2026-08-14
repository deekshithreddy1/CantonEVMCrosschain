CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, status text NOT NULL, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), status text NOT NULL, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS tenant_environments (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), project_id text NOT NULL REFERENCES projects(id), status text NOT NULL, record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id), project_id text NOT NULL REFERENCES projects(id), environment_id text NOT NULL REFERENCES tenant_environments(id), key_prefix text, secret_hash text, revoked_at timestamptz, expires_at timestamptz, record jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS credentials_prefix_idx ON credentials(key_prefix) WHERE revoked_at IS NULL;
-- Tenant-owned operational tables must carry these columns and enable equivalent RLS.
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS organization_id text;
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS environment_id text;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_execution_tenant_isolation ON workflow_executions;
CREATE POLICY workflow_execution_tenant_isolation ON workflow_executions USING (organization_id=current_setting('interweave.organization_id',true) AND project_id=current_setting('interweave.project_id',true) AND environment_id=current_setting('interweave.environment_id',true)) WITH CHECK (organization_id=current_setting('interweave.organization_id',true) AND project_id=current_setting('interweave.project_id',true) AND environment_id=current_setting('interweave.environment_id',true));
