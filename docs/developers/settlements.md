# Settlements

## What it is

A settlement coordinates multiple asset legs either with network-native atomic execution or a cross-network saga.

## Why it exists

Delivery-versus-payment semantics differ radically when both legs share a ledger versus when Canton and EVM finalize independently.

## Example

A Canton RWA delivery against EVM test USDC reserves delivery, waits for payment finality, then executes delivery and reconciliation. The API reports `CROSS_NETWORK_SAGA`.

## Failure cases

Before payment finality a safe reservation may be cancelled. After payment finality, delivery ambiguity cannot be automatically reversed and enters recovery/manual review. Reconciliation mismatch prevents completion.

## API usage

Create at `POST /v1/settlements` with `settlements:create`; retrieve `/v1/settlements/{id}` and inspect each leg and the declared execution mode.
