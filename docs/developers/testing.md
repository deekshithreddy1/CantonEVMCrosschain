# Testing

## What it is

The test strategy combines unit/integration tests, a full supply golden path, failure injection, state/supply properties, Solidity fuzz-style execution, DAML authorization scenarios, and deployment safety gates.

## Why it exists

A successful demo does not prove restart safety, replay resistance, domain separation, privacy, or backing invariants.

## Example

```bash
npm run check
npm run test:golden-path
npm run test:failure-injection
npm run test:security-invariants
npm test
```

## Failure cases

Sandbox process restrictions may require permission to spawn tests; Ganache can use a slower JS fallback; Docker/DAML may be missing. Never waive a failing safety test to promote an environment.

## API usage

Test clients should use isolated tenants and deterministic idempotency/operation IDs. Assert terminal state, finality evidence, audit reconstruction, and reconciliation—not only HTTP status.
