# Networks

## What it is

A network records type, environment, endpoints, chain identity, adapter configuration, enabled state, and an explicit finality policy.

## Why it exists

The same asset operation means different things on Canton and EVM. Network records make provider and finality assumptions reviewable instead of hard-coded.

## Example

An EVM testnet network may require chain ID `11155111`, canonical receipt inclusion, confirmations, and a finalized tag; Canton requires committed completion visible to an authorized party and synchronizer context.

## Failure cases

Wrong chain ID, provider disagreement, disabled network, malformed RPC data, missing Canton party visibility, or unmet finality policy fails closed.

## API usage

```http
GET /v1/networks
Authorization: Bearer $INTERWEAVE_API_KEY
```

Do not treat an endpoint returned by this API as globally authoritative; validators use independently administered providers.
