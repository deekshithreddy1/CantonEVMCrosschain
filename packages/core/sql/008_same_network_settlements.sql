CREATE TABLE IF NOT EXISTS same_network_settlements (
  id text PRIMARY KEY,
  network_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED','MANUAL_REVIEW')),
  request_hash text NOT NULL,
  record jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS same_network_settlements_network_idx ON same_network_settlements (network_id, recorded_at);
