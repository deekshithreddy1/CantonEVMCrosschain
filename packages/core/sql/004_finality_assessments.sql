CREATE TABLE IF NOT EXISTS finality_assessments (
  id text PRIMARY KEY,
  network_id text NOT NULL,
  transaction_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SATISFIED','PENDING','REJECTED','UNCERTAIN')),
  assessment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finality_assessments_transaction_idx ON finality_assessments (network_id, transaction_id, created_at);
