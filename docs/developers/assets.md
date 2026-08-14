# Assets

## What it is

An asset is a network-neutral instrument with issuer, decimals, supply model, bridge model, capabilities, status, and network-specific representations.

## Why it exists

Token standards alone do not prove mint, burn, lock, settlement, or compliance behavior. InterWeave registers capabilities explicitly and reconciles representation supply against verified backing.

## Example

```http
GET /v1/assets/IW%3AASSET%3Arwa
GET /v1/assets/IW%3AASSET%3Arwa/balances
```

A lock/mint asset can have 60 units locked on Canton and exactly 60 represented on EVM.

## Failure cases

Paused/degraded assets, unregistered representations, unsafe token behavior, excess mint, incompatible decimals, or reconciliation mismatch block relevant writes.

## API usage

Asset creation is `POST /v1/assets` with `assets:write`; reads require `assets:read`. Send atomic amounts according to registered decimals.
