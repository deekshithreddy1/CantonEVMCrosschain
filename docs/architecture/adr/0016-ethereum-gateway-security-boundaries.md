# ADR 0016: Minimal Ethereum gateway and verifier security boundaries

Status: Accepted (Phase 15, unaudited)

## Decision

The first Ethereum contracts are non-upgradeable and divide authority between default administration, validator management, registry management, deployment, and emergency pause roles. No coordinator role can mint or release directly. Anyone may relay an authorized execution, but the gateway executes only after threshold verification.

The EVM execution digest binds the Phase 11 canonical attestation digest to the protocol execution domain, destination chain ID, verifier contract, operation ID, effect (`MINT` or `RELEASE`), logical asset, receiver, amount, and validity interval. Signers must be unique registered validators in ascending address order. Effect binding prevents mint signatures from authorizing release or vice versa.

The gateway records `(operationId, effect)` before making the token call, uses reentrancy protection, and reverts atomically if token execution fails. Asset configuration must be enabled and resolve to the correct representation or underlying token. Representation minting is available only to the gateway. Emergency pause is role-gated and does not erase replay or registry state.

## Dependencies

- Solidity compiler 0.8.36, pinned; Shanghai EVM output.
- OpenZeppelin Contracts 5.6.1 stable release, pinned.
- ethers 6.17.0 and Ganache 7.9.2 are development-only test dependencies.

## Consequences

The contracts are minimal and deliberately not upgradeable. Changing verifier semantics requires a reviewed deployment/migration rather than an implicit proxy upgrade. Validator rotation is available through a separate validator-admin role, but production governance, timelocks, HSM-backed keys, deployment ceremony, fuzz/property tests, and independent audit remain mandatory. This phase is tested locally but is not an audit or production approval.
