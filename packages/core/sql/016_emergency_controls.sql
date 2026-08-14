CREATE TABLE IF NOT EXISTS emergency_controls (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  project_id text NOT NULL,
  environment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','LIFTED')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emergency_controls_scope_status_idx ON emergency_controls(organization_id,project_id,environment_id,status);
ALTER TABLE emergency_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY emergency_controls_tenant_isolation ON emergency_controls USING (organization_id=current_setting('interweave.organization_id',true) AND project_id=current_setting('interweave.project_id',true) AND environment_id=current_setting('interweave.environment_id',true));
