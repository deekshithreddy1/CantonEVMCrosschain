# ADR 0019: Durable EVM-to-Canton burn/release orchestration

Status: Accepted (Phase 18 orchestration slice)

## Decision

The reverse path uses a replay-protected EVM representation burn as its source event. The gateway records the burn operation ID before destruction and emits the logical asset, owner, amount, and destination Canton receiver hash. Independent validators verify the finalized burn before producing a threshold attestation.

The durable coordinator persists evidence for burn submission/confirmation/finality, threshold attestation, Canton release submission/confirmation/finality, and reconciliation. Canton release must consume a one-time `ReleaseAuthorization`. Retries reuse persisted evidence and immutable operation IDs; a supply/backing mismatch terminates in `RECONCILIATION_FAILED`.

## Consequences

The local orchestration proves the round-trip state machine and the contract test proves burn replay protection. A live MVP still requires concrete EVM event readers and transaction submitters, Canton Token Standard release execution, PostgreSQL integration, and a reproducible Canton/Anvil environment. Until then, no production round-trip claim is made.
