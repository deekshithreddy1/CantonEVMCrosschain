# ADR 0008: Deterministic, versioned policy decisions

Status: Accepted (Phase 7)

## Decision

Policy evaluation consumes a complete immutable input snapshot: asset state, sender and receiver IDs, binding-presence facts, exact atomic amount, operation, source and destination networks, metadata, and caller-supplied evaluation timestamp. Rules cannot read clocks, databases, RPC providers, or environment state.

Policies use immutable numeric versions and an explicit document hash. Rule conditions and outcomes are declarative. `DENY` dominates `REQUIRES_APPROVAL`, which dominates `ALLOW`, independent of rule order. Reason codes and matched rule IDs are sorted for reproducibility. A missing or inactive policy denies by default. A policy must contain explicit rules and cannot configure `ALLOW` as its unmatched default.

The preflight API returns the same `PolicyDecision` shape that a transaction must persist, including exact policy ID and version. Adapters and transaction coordinators must refuse `DENY` and must not execute `REQUIRES_APPROVAL` without a later approval record.

## Consequences

Facts such as KYC status, sanctions results, or active identity bindings must be resolved into the input snapshot before evaluation and stored with appropriate evidence elsewhere. Changing policy requires a new version. Phase 7's in-memory registry must later be replaced with transactional persistence and activation audit records.
