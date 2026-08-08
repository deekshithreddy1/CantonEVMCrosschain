CREATE TABLE IF NOT EXISTS normalized_events (
  id text PRIMARY KEY,
  network_id text NOT NULL,
  source_event_key text NOT NULL,
  event_type text NOT NULL,
  event jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, source_event_key)
);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  indexer_id text NOT NULL,
  network_id text NOT NULL,
  sequence numeric(78,0) NOT NULL CHECK (sequence >= 0),
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indexer_id, network_id)
);
