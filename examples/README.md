# InterWeave reference applications

The runnable implementations live in `apps/examples` and reuse `@interweave/core` rather than duplicating protocol logic.

```bash
npm run examples
npm run examples -- rwa-bridge
npm run examples -- settlement
npm run examples -- collateral-credit
```

1. **Canton RWA → EVM representation** issues 1,000 demo units, locks 100, represents exactly 100, and verifies backing.
2. **Canton tokenized asset ↔ EVM test USDC settlement** runs reciprocal delivery/payment as `CROSS_NETWORK_SAGA_NON_ATOMIC`, with compensation allowed only before payment finality.
3. **EVM collateral → Canton credit line** uses evidence-only attestation plus an enabled, versioned, permissioned handler. The attestation itself has no destination mutation authority.

These examples use deterministic adapters so they run in CI. Replace those adapters with the local Digital Asset validator and Anvil/Sepolia connectors for environment testing; the safety and state boundaries remain the same.
