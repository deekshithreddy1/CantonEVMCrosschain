# ADR 0031: Audit history is immutable and reconstructable

## Status

Accepted (Phase 32)

## Decision

Every operation audit entry is tenant-scoped structured evidence with an actor, action, category, transaction and operation IDs, canonical payload hash, sequence, previous-record hash, and record hash. The per-transaction hash chain is verified before reconstruction. PostgreSQL row-level security isolates tenants, while a trigger rejects updates and deletes.

Reconstruction from one InterWeave transaction ID reports requests, exact policy evidence, source and destination transactions/finality, attestations and validator signatures, reconciliation, state transitions, and administrator interventions. It reports missing required categories instead of claiming completeness. Secret-like fields are rejected at ingestion.

## Consequences

Operators can reconstruct a lifecycle without joining mutable application logs. Corrections and interventions are new records; original evidence is never overwritten. Database backups and external retention/WORM controls remain deployment responsibilities.
