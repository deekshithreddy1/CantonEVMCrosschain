# ADR 0014: Configurable threshold attestations and validator rotation

Status: Accepted (Phase 13)

## Decision

Thresholds are immutable validator-set configuration, never constants. Each set defines unique validator identities and keys, a threshold, and a non-overlapping effective interval. An attestation may be evaluated only against the set effective at its signed `validFrom`; rotation registers a new set beginning when the previous set ends.

Aggregation verifies every supplied signature over Phase 11 canonical bytes. Only distinct, enabled members using their registered algorithm and key count. Unknown members, duplicate validators, disabled members, key mismatch, invalid signatures, insufficient threshold, and expired attestations fail closed. Invalid supplied signatures make the complete threshold result invalid rather than being silently discarded.

## Consequences

Development can configure 1-of-1, test environments 2-of-3, and production a reviewed threshold such as 3-of-5 without code changes. Historical verification remains possible with retained immutable sets, while non-overlapping intervals prevent choosing an obsolete weaker set for a new attestation. Destination contracts and Canton workflows must reproduce these checks and persist replay state in Phase 15 and Phase 16.
