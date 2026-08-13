# ADR 0025: Versioned workflows use permissioned actions

## Status

Accepted (Phase 24)

## Decision

Workflow definitions are immutable versioned data: a source network and predicate, exact scalar claim constraints, an exact policy version, and one predefined action type. Initial actions are Canton collateral recording, EVM payment initiation, and Canton eligibility recording. Definitions cannot contain executable code or nested arbitrary payloads.

Execution re-verifies the generic attestation and validity, matches the source predicate, and requires an `ALLOW` from the exact configured policy version before dispatch. The durable execution claim precedes the destination action. Handlers deduplicate with the execution ID and may return `ALREADY_APPLIED` during crash recovery. Ambiguous effects require manual review.

## Consequences

Phase 23 evidence has no ambient mutation authority. Only a separately registered, enabled workflow and configured trusted action handler can cause an action. Adding action types requires code review and deployment, not user-supplied code.
