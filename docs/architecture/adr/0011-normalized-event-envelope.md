# ADR 0011: Versioned normalized event envelope and checkpoints

Status: Accepted (Phase 10)

## Decision

Canton and EVM indexers translate decoded ledger events into a versioned, network-neutral envelope. Every event carries a deterministic logical event ID, semantic type, network and transaction IDs, logical asset ID, ledger position, event time, payload, ingestion time, observation status, and network-specific provenance.

Event identity derives from network ID plus the immutable source event key. EVM keys use transaction hash and log index; block hash and number remain position evidence, and removed logs retain the same identity with `REMOVED` observation. Canton keys use transaction ID, offset, and event index, with participant and witnessed-party scope retained as provenance.

PostgreSQL deduplicates on network and source event key. Each indexer/network pair stores a monotonically increasing checkpoint separately from event data. Processing writes each event before advancing its checkpoint; after a crash, replay can repeat an event but the unique source key prevents duplicate downstream records.

## Consequences

Semantic decoders remain adapter-specific and must map representation locators to logical asset IDs without guessing. Consumers must handle schema versions and EVM removal observations. Production processing should place event insertion, outbox publication, and checkpoint advancement in one database transaction; Phase 10 currently exposes these primitives but does not yet add the event-distribution outbox.
