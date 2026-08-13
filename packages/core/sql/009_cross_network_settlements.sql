CREATE TABLE IF NOT EXISTS cross_network_settlements (
  id text PRIMARY KEY,
  request_hash text NOT NULL,
  state text NOT NULL,
  version integer NOT NULL,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cross_network_settlement_transitions (
  settlement_id text NOT NULL REFERENCES cross_network_settlements(id),
  sequence integer NOT NULL,
  state text NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (settlement_id, sequence)
);
