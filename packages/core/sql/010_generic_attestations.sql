CREATE TABLE IF NOT EXISTS generic_attestations (
  id text PRIMARY KEY,
  source_network_id text NOT NULL,
  predicate_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED','REJECTED')),
  request_hash text NOT NULL,
  record jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generic_attestations_source_idx ON generic_attestations (source_network_id, predicate_type, recorded_at);
