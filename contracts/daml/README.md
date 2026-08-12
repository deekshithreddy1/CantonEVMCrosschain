# Daml contracts

Phase 16 provides explicitly authorized, one-time interoperability workflows for bridge intent, locked asset evidence, validator-owned attestation records, release authorization, and released state.

Token Standard holdings are represented by opaque `TokenHoldingRef` values carrying the standard, instrument ID, and holding ID. Concrete CIP-0056/CIP-0112 package operations remain behind the Canton adapter boundary; these workflows do not claim to move a live Token Standard holding yet.

```bash
npm run daml:check
npm run daml:test
```

The tests cover legitimate release, unauthorized controllers, wrong assets, wrong destinations, expiry, duplicate/consumed authorization, and privacy visibility. Local sandbox authorization does not replace production Ledger API authentication and party rights.
