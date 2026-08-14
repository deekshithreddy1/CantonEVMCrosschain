# Concepts

## What it is

InterWeave models networks, logical assets, network representations, identities, policy decisions, durable transactions, attestations, settlements, workflows, and reconciliation as separate objects.

## Why it exists

A Canton contract ID and an EVM address are locators, not portable identities. Keeping logical IDs separate prevents network details from leaking into business rules and prevents “submitted” from being confused with “finalized.”

## Example

`IW:ASSET:treasury-note` can have a Canton instrument representation and an ERC-20 representation. A bridge operation references the logical asset while its adapters resolve the relevant locators.

## Failure cases

Unsupported capabilities, missing identity bindings, policy denial, uncertain finality, insufficient validator threshold, destination failure, and reconciliation mismatch all stop or divert the operation; none implies automatic cross-network rollback.

## API usage

Create or retrieve resources under `/v1`; retain `IW:*` IDs. Amounts are exact integer strings and cross-network outcomes must be polled until a terminal state.
