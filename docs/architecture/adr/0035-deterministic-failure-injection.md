# ADR 0035: Deterministic failure injection protects financial boundaries

## Status

Accepted (Phase 36)

## Decision

Failure injection runs against a durable model of the golden path. Coordinator and database crashes are injected after lock, lock attestation, mint, burn, burn attestation, and release. Recovery reuses persisted checkpoints and operation/effect keys instead of repeating financial mutations.

The suite also injects validator restart, RPC timeout, malformed RPC data, duplicate events/API requests/attestations, invalid and expired signatures, wrong destination/chain/asset domains, destination revert, Canton rejection, message redelivery, temporary partition, and a simulated chain reorganization. Every fault must either fail closed or recover, and the supply invariant is assessed immediately after the fault and after recovery.

## Consequences

The successful Phase 35 path is no longer sufficient by itself. CI separately proves that interruption and adversarial input cannot create excess representation supply or execute a finalized effect twice. The deterministic harness complements—not replaces—live environment chaos testing before production deployment.
