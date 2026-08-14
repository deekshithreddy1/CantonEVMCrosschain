# ADR 0038: Emergency controls are granular, durable safety gates

## Status

Accepted (Phase 39)

## Decision

Emergency response uses independently addressable controls for an asset, source network, destination network, bridge direction, mint, release, or settlement. Every control is tenant-scoped, persisted, exposed through the REST boundary, and checked before the corresponding financial action.

Activation requires the emergency-operator role. Lifting requires the distinct emergency-admin role and a recorded reason. Both actions emit immutable audit events. A pause changes execution eligibility only: it does not delete transaction history, finality evidence, queued work, or reconciliation records.

## Consequences

Operators can contain an incident without unnecessarily disabling unrelated routes. Recovery remains deliberate because the actor who activates a control cannot lift it without separate authority. Deployment wiring must place `assertAllowed` immediately before each financial submission and retain destination-ledger enforcement as defense in depth.
