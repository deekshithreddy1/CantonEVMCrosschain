# Transfers

## What it is

A transfer moves an asset between identities on one network through that network’s native transaction model.

## Why it exists

Same-network transfers should not pay the complexity or trust cost of a cross-network bridge. They can use ledger-native atomicity where the adapter proves it.

## Example

```http
POST /v1/transfers
Idempotency-Key: payroll-2026-08-alice
Content-Type: application/json

{"assetId":"IW:ASSET:usd","networkId":"IW:NETWORK:canton","sender":"IW:IDENTITY:treasury","receiver":"IW:IDENTITY:alice","amount":"10000"}
```

## Failure cases

Policy denial, insufficient balance, inactive identity binding, adapter rejection, timeout, or uncertain finality prevents a completed result.

## API usage

Create with `transfers:create`; retrieve `/v1/transfers/{id}`. API acceptance is not ledger finality—inspect transaction/finality fields.
