# ADR 0004: Registry boundaries and capability evidence

Status: Accepted (Phase 2–3)

## Decision

Network and asset registries expose asynchronous interfaces so the in-memory Phase 2–3 implementation can later be replaced by durable persistence without changing consumers. Registry records use logical InterWeave IDs and return defensive copies.

Network endpoints are configuration references, never credential stores. EVM chain IDs are decimal strings to avoid numeric truncation, and uniqueness is enforced among EVM networks. Network types remain extensible; type-specific validation applies only to the known `EVM` and `CANTON` types.

Asset capabilities have two independent inputs: issuer/control-plane declarations and adapter discovery evidence. Effective capabilities are their intersection and are empty before discovery, while an asset is not active, or while its representation is disabled. A token-standard label never grants a capability. Discovery evidence records its source, observation time, and adapter-defined proof metadata.

## Consequences

The current storage is process-local and not production durable. Adapters in Phase 4–5 must implement evidence-producing discoverers, and a later persistence phase must preserve uniqueness transactionally. Callers cannot interpret registration as proof that an operation is authorized.
