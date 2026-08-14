# ADR 0041: Developer documentation exposes failure and trust semantics

## Status

Accepted (Phase 42)

## Decision

Every developer concept documents what it is, why it exists, a concrete example, failure cases, and API usage. Cross-network pages explicitly describe sagas, independent finality, validator thresholds, one-time destination execution, and reconciliation rather than using “atomic” as shorthand.

Documentation structure is checked in CI. Public guides link to the deeper trust model, threat model, and operator procedures.

## Consequences

An integration can be designed around real terminal states and recovery boundaries instead of optimistic marketing assumptions. New conceptual pages must preserve the same five-part contract.
