# ADR 0037: Threats are documented against explicit trust boundaries

## Status

Accepted (Phase 38)

## Decision

The security model is maintained in `docs/security/threat-model.md`. Every identified threat documents the asset at risk, attacker preconditions, detection signals, preventive controls, recovery procedure, and residual risk. The model distinguishes implemented technical controls from production prerequisites and maps major claims to executable tests.

Safety takes priority over liveness. Uncertain finality, authorization, supply, or evidence causes a narrow pause, failed operation, or manual review; recovery never silently rewrites history or assumes cross-network rollback.

## Consequences

Reviewers and operators have one auditable description of the system's trust assumptions and response posture. The document must change whenever a trust boundary, key role, ledger integration, asset behavior, or emergency procedure changes.
