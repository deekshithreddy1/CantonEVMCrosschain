# ADR 0012: Canonical, domain-separated attestation bytes

Status: Accepted (Phase 11)

## Decision

Attestation v1 signs a strict canonical JSON projection prefixed by a NUL-separated domain containing the protocol name, version, source network ID, and destination network ID. Every security-relevant field is inside the signed projection. Amounts remain exact integer strings and timestamps are ISO instants with a validated observation/validity ordering.

Validator signatures are external to the signed payload and sorted by validator ID when attached. A validator may appear at most once. Signing and verification use injected cryptographic providers so key custody, HSMs, and approved algorithms remain deployment concerns without changing canonical bytes.

## Consequences

Any schema change requires a new protocol version and test vectors. Destinations must reject unsupported versions, expired attestations, invalid signatures, duplicate validators, mismatched domains, and previously consumed replay keys. Phase 11 does not claim validators verified the underlying event; that begins in Phase 12.
