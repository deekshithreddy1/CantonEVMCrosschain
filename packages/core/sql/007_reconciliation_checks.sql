CREATE TABLE IF NOT EXISTS reconciliation_checks (
  id text PRIMARY KEY,
  asset_id text NOT NULL,
  representation_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('MATCH','MISMATCH')),
  record jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reconciliation_checks_asset_idx ON reconciliation_checks (asset_id, representation_id, checked_at);
