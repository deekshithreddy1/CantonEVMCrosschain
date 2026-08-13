# ADR 0024: Generic state attestations are evidence-only

## Status

Accepted (Phase 23)

## Decision

Generic attestations bind a source network, transaction/event position, typed predicate, canonical scalar claims, policy version, validator set, nonce, and validity window. They are domain-separated from bridge-transfer attestations.

Validators independently observe canonical source state and finality. A threshold artifact is produced only when their claims and observed position agree. Provider errors, claim mismatches, insufficient threshold, disagreement, and expiry fail closed. Requests and results are immutable and replay-safe.

The artifact is explicitly `VERIFIED_EVIDENCE_ONLY` with `destinationMutationAuthorized: false`. This service has no destination executor. A versioned, enabled workflow with a predefined permissioned action must separately authorize any later state mutation.

## Consequences

Events such as Ethereum `CollateralDeposited` can be verified and recorded for Canton consumers without giving an attestation ambient authority to activate a credit line. Phase 24 owns that authorization boundary.
