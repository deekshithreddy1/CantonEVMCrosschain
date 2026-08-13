# ADR 0023: Cross-network settlement is a saga

## Status

Accepted (Phase 22)

## Decision

A Canton-to-EVM or EVM-to-Canton settlement is explicitly described as `CROSS_NETWORK_SAGA_NON_ATOMIC`. Its durable sequence is policy check, delivery reservation and verification, payment submission and finality verification, payment attestation, delivery release and verification, reconciliation, and completion.

The compensation contract is fixed before execution: a delivery reservation may be cancelled only before payment finality. Once payment is final, automatic reversal is prohibited; failures, expiry, or ambiguity require retry or manual review with preserved evidence. Reconciliation mismatch can never complete a settlement.

Every external action must be idempotent under the settlement ID. Each successful boundary stores verifiable transaction and ledger-position evidence before the next action.

## Consequences

The API exposes its weaker cross-network guarantee instead of implying ledger-native atomicity. Users must account for timeouts and an operational intervention window after irreversible payment finality.
