# ADR 0036: Security invariants are executable properties

## Status

Accepted (Phase 37)

## Decision

Each roadmap security invariant has a named, independently executable proof. Seeded property tests explore arbitrary supply effects and bridge transition requests while remaining exactly reproducible. Solidity fuzz-style tests deploy the real gateway and verifier, generate varied amounts and operation identifiers, and prove exact balances and one-time execution after every call.

CI runs these properties separately from the ordinary regression suite. Seeds are fixed for reproducibility; future CI may add rotating seeds while retaining any failing seed as a permanent regression case.

## Consequences

Replay protection, domain separation, validator membership and threshold, pause/admin authorization, retry idempotency, backing limits, and reconciliation gating are release-visible properties rather than implicit claims spread across implementation tests.
