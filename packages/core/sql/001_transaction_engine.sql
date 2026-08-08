CREATE TABLE IF NOT EXISTS bridge_operations (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL,
  state text NOT NULL,
  version integer NOT NULL CHECK (version >= 0),
  operation jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bridge_transitions (
  operation_id text NOT NULL REFERENCES bridge_operations(id),
  transition_key text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  from_state text,
  to_state text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  PRIMARY KEY (operation_id, transition_key),
  UNIQUE (operation_id, sequence)
);

CREATE TABLE IF NOT EXISTS transaction_attempts (
  operation_id text NOT NULL REFERENCES bridge_operations(id),
  attempt_key text NOT NULL,
  step text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('STARTED','SUCCEEDED','FAILED')),
  error_code text,
  occurred_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (operation_id, attempt_key),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);
