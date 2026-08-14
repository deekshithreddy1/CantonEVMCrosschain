# ADR 0043: MVP completion requires live ledger evidence

## Status

Accepted (post-Phase 43 completion audit)

## Decision

The definition of MVP is represented by a machine-checked evidence manifest. Deterministic coordinator tests and examples prove logic but cannot satisfy criteria that explicitly require running Canton and EVM environments. Those criteria remain pending until the official Digital Asset LocalNet produces package IDs, transactions, finality positions, validator attestations, and reconciliation evidence.

## Consequences

The repository reports `MVP_NOT_COMPLETE` despite broad implementation coverage. This avoids promoting a simulated golden path into a claim of live cross-network interoperability.
