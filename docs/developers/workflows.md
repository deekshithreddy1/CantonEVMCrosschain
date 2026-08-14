# Workflows

## What it is

A workflow maps a verified event predicate to a predefined, versioned, policy-authorized destination action.

## Why it exists

Generic attestations must not become arbitrary remote code execution. Only reviewed action handlers can mutate destination state.

## Example

A finalized Ethereum collateral deposit satisfying an exact predicate can activate a predefined Canton credit-line handler after policy approval.

## Failure cases

Unknown action type, disabled/version mismatch, predicate mismatch, invalid evidence, policy denial, uncertain destination result, or replay fails closed or enters manual review.

## API usage

Workflow administration is intentionally not exposed as arbitrary script upload. Use registered versions and query the resulting transaction/audit records through `/v1/transactions/{id}`.
