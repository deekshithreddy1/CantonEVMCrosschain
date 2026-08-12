# Ethereum contracts

Phase 15 provides a minimal, non-upgradeable contract architecture:

- `AttestationVerifier`: destination-chain/domain/effect-bound ECDSA threshold verification and validator administration.
- `InterWeaveGateway`: replay-protected mint/release execution, role-separated pause control, and reentrancy protection.
- `InterWeaveAssetRegistry`: logical asset to representation/underlying-token configuration.
- `InterWeaveRepresentation` and `RepresentationFactory`: gateway-authorized ERC-20 representations and one-time deployment.
- `EmergencyController`: separately permissioned gateway pause/unpause calls.

Dependencies are pinned to Solidity 0.8.36 and OpenZeppelin Contracts 5.6.1. Compilation targets the Shanghai EVM. Run:

```bash
npm run contracts:check
npm run contracts:test
```

Validator signatures are over `executionDigest`, which binds the Phase 11 attestation digest to chain ID, verifier address, operation, effect, logical asset, receiver, amount, and validity interval. Signatures must be ordered by ascending signer address so duplicates are rejected without storage-heavy enumeration.

These contracts are unaudited and must not hold production value. Validator governance, key custody, deployment scripts, invariant fuzzing, and an independent audit remain production-readiness requirements.
