# ADR 0018: Durable Canton-to-EVM lock/mint orchestration

Status: Accepted (Phase 17 orchestration slice)

## Decision

The first golden path is a restart-safe coordinator over the durable Phase 8 state machine. It progresses through policy, Canton lock submission/confirmation/finality, independent threshold attestation, replay-protected EVM mint submission/confirmation/finality, and reconciliation. Every external stage stores immutable evidence under `(operationId, stage)` before its state transition.

Retries reuse stored evidence. If a process fails after a network effect but before evidence persistence, it resubmits the same immutable operation ID: Canton lock integration must use command deduplication and the EVM gateway enforces on-chain replay protection. A reconciliation mismatch terminates in `RECONCILIATION_FAILED`; it is never reported as complete.

The coordinator depends on explicit production interfaces for policy, Canton lock/finality, validators/threshold aggregation, EVM mint/finality, and reconciliation. Test doubles live only in tests and are not selectable production implementations.

## Consequences

The orchestration and recovery semantics are executable and tested without claiming a live two-network deployment. Completion of the deployable Phase 17 golden path still requires concrete Canton Token Standard lock commands, validator network readers, EVM transaction submission, PostgreSQL migrations, and local Canton/Anvil integration supplied by later environment work.
