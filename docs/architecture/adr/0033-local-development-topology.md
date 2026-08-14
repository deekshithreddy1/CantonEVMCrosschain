# ADR 0033: Reproducible local development topology

## Status

Accepted (Phase 34)

## Decision

Docker Compose is the canonical local orchestration boundary. PostgreSQL and NATS provide durable state and messaging, Canton Sandbox and Anvil provide real local ledgers, and each InterWeave runtime role is represented by a separately health-checked process. Three validators make the trust topology visible even though local fixtures use development credentials.

Bootstrap is automatic, dependency-gated, repeatable, and stores a machine-readable deployment manifest in a named volume. Canton initialization creates parties, route configuration, and test assets; EVM initialization uses Anvil's funded development account to deploy and configure protocol contracts.

## Consequences

A new engineer needs only Docker Compose to reproduce the same topology. Local credentials and 1-of-1 contract verification are conspicuously development-only and cannot be treated as production configuration. Phase 35 can exercise the golden path against stable service names and bootstrap state.
