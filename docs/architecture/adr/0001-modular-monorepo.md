# ADR-0001: Modular monorepo and durable control plane

Status: Accepted (2026-08-08)

Use a TypeScript-first npm-workspace monorepo. Start with a modular control-plane deployment and separate only validators, signers, reconcilers, and indexers. PostgreSQL will be authoritative; NATS JetStream is the initial broker candidate. Network adapters prevent protocol-specific identifiers from contaminating the public model.

This reduces distributed failure modes while retaining security boundaries. Go workers, Solidity, and Daml are introduced only with their corresponding implementation phases.
