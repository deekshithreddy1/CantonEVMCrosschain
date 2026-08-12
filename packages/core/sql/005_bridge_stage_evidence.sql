CREATE TABLE IF NOT EXISTS bridge_stage_evidence (
  operation_id text NOT NULL REFERENCES bridge_operations(id),
  stage text NOT NULL,
  evidence jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, stage)
);
