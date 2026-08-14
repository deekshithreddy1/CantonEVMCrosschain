# ADR 0027: TypeScript SDK is network-neutral by default

## Status

Accepted (Phase 26)

## Decision

`@interweave/sdk` exposes typed resource clients for networks, assets, identities, transfers, bridge operations, settlements, attestations, transactions, and webhooks. All writes carry an idempotency key; callers may supply a stable key or use the generated default. Authentication, timeouts, URL encoding, envelopes, and API errors are handled centrally.

Ordinary methods return only network-neutral domain objects. Request IDs, response headers, and future provider-specific metadata require the explicit `raw.request` surface. HTTPS is required except for localhost development.

## Consequences

Application code does not need to know Canton Ledger API or EVM provider details. The low-level escape hatch remains available for diagnostics without contaminating the default developer experience.
