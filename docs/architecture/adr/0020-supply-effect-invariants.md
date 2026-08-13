# ADR 0020: Append-only supply effects and backing invariants

Status: Accepted (Phase 19)

## Decision

Finalized `LOCK`, `MINT`, `BURN`, and `RELEASE` effects are recorded in an append-only ledger keyed by immutable `(operationId, effect)`. Identical retries are idempotent; reuse with different amount or evidence is rejected. Every proposed effect is evaluated before persistence inside a transaction protected by a per-asset/representation advisory lock, preventing concurrent writers from validating against stale totals.

For each logical asset representation, the ledger enforces:

- total minted does not exceed total finalized locked backing;
- total burned does not exceed total minted;
- total released does not exceed total verified burned or total locked backing;
- circulating representation supply (`minted - burned`) does not exceed verified backing (`locked - released`).

The invariant layer does not infer network truth. Records require finalized evidence IDs supplied by the finality/validator path, and reconciliation independently checks the resulting ledger totals against live networks.

## Consequences

One source operation/effect can contribute to supply exactly once, retries cannot duplicate financial effects, and unsafe mint/release attempts fail before accounting persistence. The ledger is a control-plane safety mechanism, not a substitute for on-chain replay protection or Canton consuming authorization.
