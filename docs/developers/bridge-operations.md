# Bridge Operations

## What it is

A bridge operation is a durable lock→finalize→attest→mint or burn→finalize→attest→release saga between different networks.

## Why it exists

Canton and EVM do not share an atomic commit. Persisted stages make irreversible boundaries, retries, and manual recovery honest and observable.

## Example

```http
POST /v1/bridge/transfers
Idempotency-Key: move-rwa-100-001
Content-Type: application/json

{"assetId":"IW:ASSET:rwa","sourceNetworkId":"IW:NETWORK:canton","destinationNetworkId":"IW:NETWORK:sepolia","sender":"IW:IDENTITY:alice","receiver":"IW:IDENTITY:alice","amount":"100"}
```

## Failure cases

Source failure, expired/insufficient attestation, destination revert, network pause, timeout after irreversible execution, or reconciliation mismatch produces a terminal failure or manual review—not a fictional rollback.

## API usage

Creation requires `bridge:create` and idempotency. Poll `/v1/bridge/transfers/{id}` and use the transaction/audit API to reconstruct evidence.
