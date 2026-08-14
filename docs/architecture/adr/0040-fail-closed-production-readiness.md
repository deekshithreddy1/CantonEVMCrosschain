# ADR 0040: Production readiness is an evidence gate

## Status

Accepted (Phase 41 framework; production remains not ready)

## Decision

Production eligibility is computed from a source-controlled manifest. Every mandatory review and operational requirement must be explicitly approved with evidence. Documentation or automated tests alone cannot approve independent audits, live testnet qualification, or backup restoration. Automatic environment promotion is prohibited.

## Consequences

`npm run production:readiness` gives a transparent report; `npm run production:assert-ready` fails while any gate lacks approval. The current result is intentionally `NOT_READY`, preventing technical completeness from being confused with authorization to handle production-value assets.
