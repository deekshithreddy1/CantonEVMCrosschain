# ADR 0021: Independent reconciliation and fail-safe degradation

Status: Accepted (Phase 20)

## Decision

Reconciliation runs independently from both bridge coordinators and obtains source and destination state through an `IndependentReconciliationReader`. Each immutable check preserves network positions and raw evidence while comparing canonical supply, source circulating supply, locked backing, destination representation supply, pending operations, and completed mint/burn/release totals.

A critical mismatch is never repaired automatically. The service persists the mismatch first, marks the asset degraded, blocks new bridge issuance by default, emits a critical alert, and requires explicit operator resolution. Policy may disable automatic issuance blocking, but degradation, evidence preservation, and alerting remain mandatory.

## Consequences

Coordinator database agreement alone cannot produce a successful reconciliation. Production readers must query independently authorized Canton state and finalized EVM state. Asset-status and issuance-block implementations must be durable and audited; this phase defines their fail-safe control boundary without silently mutating ledger balances.
