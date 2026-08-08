# ADR 0009: PostgreSQL-authoritative bridge state machine

Status: Accepted (Phase 8)

## Decision

Bridge workflow state is authoritative only in PostgreSQL. `bridge_operations` stores the current snapshot and optimistic version; `bridge_transitions` stores every immutable transition. Updates lock the operation row, require the expected version, insert the transition, and update the snapshot in one database transaction.

The engine defines a closed legal transition graph. Failure states and `COMPLETED` are terminal. Nonterminal operations may enter `EXPIRED` or `MANUAL_REVIEW`; neither implies rollback. Policy success requires a persisted `ALLOW` decision and rejection requires a non-allow decision.

Each transition carries a stable transition key. Replaying the same key and destination is idempotent; reusing it for different content fails. External request idempotency remains Phase 9. Retry attempts are persisted separately with step, attempt number, outcome, and classified error so retries never masquerade as workflow progress.

## Consequences

All production callers must use `PostgresTransactionStore`; process memory may only cache snapshots. The migration in `packages/core/sql/001_transaction_engine.sql` must run before the coordinator starts. Multi-worker contention produces explicit stale-version conflicts that callers reload and resolve. Database backups, migration rollback procedures, retention, and integration tests against real PostgreSQL remain operational work.
