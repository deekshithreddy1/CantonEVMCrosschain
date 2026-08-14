# Attestations

## What it is

An attestation is canonical, domain-separated evidence that a configured threshold of validators independently observed a source fact.

## Why it exists

The coordinator cannot be trusted as a truth oracle. Destination execution needs verifiable claims bound to source, destination, chain, asset, amount, receiver, operation, policy, nonce, and validity window.

## Example

Two members of a 2-of-3 validator set sign the same canonical digest after independently confirming a finalized Canton lock. The EVM verifier accepts sorted, unique active members only.

## Failure cases

Invalid/duplicate/disabled signer, insufficient threshold, expiry, wrong chain/asset/destination/effect, changed payload, or replay is rejected.

## API usage

Request with `POST /v1/attestations` and `attestations:create`; retrieve `/v1/attestations/{id}`. An attestation is evidence, not permission to execute arbitrary code.
