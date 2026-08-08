# ADR 0007: Proof-bearing identity bindings

Status: Accepted (Phase 6)

## Decision

Application identities use logical `IW:IDENTITY:*` IDs and can hold multiple independently verified network bindings. Creating an identity or submitting a locator grants no network authority.

A binding begins with a short-lived, single-use challenge containing a domain label, version, challenge ID, identity ID, network ID, normalized locator, nonce, issue time, and expiry. EVM challenges use personal-sign verification through an injected cryptographic verifier. Canton challenges use an equivalent authorized-command verifier boundary; a production implementation must verify a command/signature under the party's current topology authorization rather than trusting the coordinator.

Verification consumes the nonce only after valid proof, records a proof fingerprint rather than raw proof in the audit trail, and rejects a locator already actively bound on the same network. Bindings can expire or be revoked. Public identity records contain display labels and locators only, never KYC records.

## Consequences

The Phase 6 registry is in-memory. Production persistence must atomically consume challenges and enforce active-binding uniqueness to prevent concurrent replay. Production verifiers must provide EIP-191-compatible address recovery for EVM and topology-aware authorization verification for Canton. Challenge messages must remain backward compatible or introduce a new explicit version.
