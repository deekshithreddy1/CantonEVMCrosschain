# Testnet deployment runbook

Phase 40 progresses in gates; it never promotes automatically to production.

## Gate 1: Sepolia with local Canton

Set `SEPOLIA_RPC_URL` and `TESTNET_DEPLOYER_PRIVATE_KEY` using a secret manager. Fund the address with test ETH, then run `npm run testnet:preflight`. Deploy only after reviewing the chain ID and address:

```bash
INTERWEAVE_TESTNET_CONFIRM=deploy-sepolia npm run testnet:deploy:evm
```

The deployer rejects common production chain IDs, requires Sepolia chain ID `11155111`, refuses an unfunded account, and creates `deployments/testnet/sepolia.json` exactly once. Review and commit that public-address manifest; never commit the key or credential-bearing RPC URL. Run the Phase 35 golden path with local Canton and the recorded Sepolia contracts, then exercise RPC errors, finality delay, and reorganization handling from Phase 36.

## Gate 2: Canton DevNet

Canton DevNet is not a public anonymous RPC. Obtain a sponsored validator, whitelist/VPN connectivity, onboarding material, and application credentials. Set `CANTON_DEVNET_LEDGER_URL` and `CANTON_DEVNET_ACCESS_TOKEN`; run `npm run testnet:preflight -- --require-ready`. Retrieve the current migration and Splice versions during the change window, deploy the reviewed DAR to your validator, record its package ID, and rerun the complete two-network path.

## Required qualification evidence

- Real RPC latency, timeout, malformed response, finality, and error observations
- Canton and EVM transaction IDs and finalized positions for both bridge directions
- Golden path and all supply reconciliation results
- Sustained soak/capacity results with zero unexplained mismatch
- Key and validator rotation with old credentials rejected
- Contract and DAML package upgrade rehearsal, including rollback/migration decision
- Backup restore and disaster recovery with measured RPO/RTO
- Every emergency control activated and independently lifted

Promotion requires a human-reviewed testnet report and a separate production change process. No script in this repository accepts a production target.
