# ADR 0042: Reference applications exercise protocol boundaries

## Status

Accepted (Phase 43)

## Decision

Reference applications import the production core package and remain executable in CI through deterministic adapters. They demonstrate backed representation, explicitly non-atomic coordinated settlement, and evidence-triggered permissioned workflow execution. Each prints its trust/compensation boundary alongside the business result.

## Consequences

Examples demonstrate that InterWeave supports more than token bridging without hiding network assumptions. Environment adapters can replace deterministic ones without rewriting business orchestration or safety invariants.
