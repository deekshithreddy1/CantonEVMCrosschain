CREATE TABLE IF NOT EXISTS supply_effects (
  operation_id text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('LOCK','MINT','BURN','RELEASE')),
  asset_id text NOT NULL,
  representation_id text NOT NULL,
  record jsonb NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, effect)
);
CREATE INDEX IF NOT EXISTS supply_effects_asset_representation_idx ON supply_effects (asset_id, representation_id, finalized_at);
