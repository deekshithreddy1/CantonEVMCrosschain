# Finality

## What it is

Finality evidence records the configured policy, observed ledger position, provider observations, and time. Submission, confirmation, canonicality, and finalization are distinct.

## Why it exists

A transaction hash or elapsed timer is not proof that an irreversible source fact exists. EVM reorg behavior and Canton committed visibility require network-specific evidence.

## Example

An EVM receipt can be successful and canonical with 12 confirmations but still fail a policy requiring the finalized tag. Canton completion must match the authorized party/participant and expected synchronizer evidence.

## Failure cases

Revert, missing receipt, block-hash disagreement, removed log, insufficient confirmations, missing finalized tag, provider outage, or incomplete Canton visibility yields pending, failed, or uncertain—not finalized.

## API usage

Retrieve the operation/transaction and inspect finality evidence. Never infer finality from HTTP success or a submitted external transaction ID.
