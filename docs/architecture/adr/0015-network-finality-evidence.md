# ADR 0015: Network-specific finality evaluation and durable evidence

Status: Accepted (Phase 14)

## Decision

Finality is evaluated by network-specific rules behind one `FinalityService`, and every assessment is stored as an immutable record. Chain identity and policy come from trusted per-network service configuration, never from the observation being evaluated. Outcomes distinguish `SATISFIED`, `PENDING`, `REJECTED`, and `UNCERTAIN`.

EVM evaluation keeps successful receipt execution, canonical block-hash agreement, confirmation depth, and finalized-chain inclusion separate. A finalized-tag policy requires explicit finalized block evidence; a receipt alone never satisfies it. Canonical hash disagreement produces `UNCERTAIN`, preserving reorganization evidence for operator review.

Canton evaluation requires a committed completion correlated to an update ID and completion offset from a named participant under a non-empty party scope. Optional synchronizer policy is enforced. Participant offsets are recorded with participant identity because offsets and visibility are participant-local.

## Primary-source basis

- Ethereum proof-of-stake documentation defines finalized checkpoint ancestry separately from transaction execution, while JSON-RPC exposes receipts and `finalized` block queries independently.
- Canton Ledger API completion/update records correlate update IDs, offsets, synchronizers, and submitting parties; participant offsets describe that participant's local permissioned ledger view.

## Consequences

Production observers must validate actual block ancestry and RPC chain identity, and Canton observers must use authorized Ledger API connections. This phase provides policy evaluation and durable evidence storage; it does not fake live providers or claim finality for submissions lacking evidence.
