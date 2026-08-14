# ADR 0030: Signing custody is separate from orchestration

## Status

Accepted (Phase 31)

## Decision

Coordinators persist and submit signing requests containing tenant identity, purpose, immutable operation ID, opaque key reference, algorithm, payload digest, policy version, and validity window. HSM and MPC adapters receive only this reference and digest. Production private keys must never appear in application configuration, signing requests, logs, or databases.

Signing policy independently constrains environments, purposes, algorithms, key-reference namespaces, and validity. Privileged administration—validator rotation, protocol pause, and policy administration—requires the configured number of distinct approvals bound to the exact request digest. Any rejection fails closed.

`LocalDevelopmentSigner` holds an in-memory test key and accepts only `local-dev://` references in development. It is not a production custody implementation.

## Consequences

Changing custody providers does not change coordinator logic. Request, approval, and result records are immutable and replay-safe, while custody remains inside the HSM or MPC system.
