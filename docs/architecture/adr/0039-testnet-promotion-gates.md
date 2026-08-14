# ADR 0039: Testnet deployment uses explicit, non-production gates

## Status

Accepted (Phase 40 repository readiness; live deployment requires external access)

## Decision

Sepolia is the initial public EVM testnet and Canton remains local for the first live-RPC validation. Canton moves to DevNet only after sponsored-validator and VPN access are available. Deployment tooling validates exact network identity, funding, explicit confirmation, and immutable evidence output; it rejects production environments and known production EVM chain IDs.

No testnet result promotes automatically. Soak, capacity, failure, rotation, upgrade, backup, and disaster-recovery evidence require human review before any later production process begins.

## Consequences

The repository can safely prepare and verify a deployment without possessing credentials. Actual Phase 40 network qualification remains an operational gate and cannot be represented as complete until funded Sepolia transactions and sponsored Canton DevNet evidence exist.
