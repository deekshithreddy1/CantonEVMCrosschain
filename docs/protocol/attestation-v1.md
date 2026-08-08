# Attestation Protocol v1

An InterWeave attestation is a validator-signed statement about independently observed finalized source state. It is not a coordinator assertion and does not itself merge network consensus.

The canonical unsigned object contains: protocol version, attestation and operation IDs, source network type and logical ID, source transaction and event position, event type, logical asset ID, exact atomic amount, sender and receiver identities, destination network type and logical ID, nonce, observed state position and time, validity interval, and policy version.

Signatures cover UTF-8 bytes of:

```text
INTERWEAVE_ATTESTATION|<version>|<sourceNetworkId>|<destinationNetworkId> NUL <canonical-json>
```

Canonical JSON sorts object keys, preserves array order, permits only JSON-safe values, and represents amounts as base-10 integer strings. Signatures never cover other signatures. The replay key binds protocol version, operation ID, nonce, and destination network.

Changing a network, asset, destination, operation, amount, party, event position, validity time, policy version, nonce, or protocol version changes the signed bytes. Version 1 requires `observedAt <= validFrom < expiresAt`; signatures at or beyond expiry are invalid.

Phase 11 defines serialization and cryptographic interfaces. Validator membership, independent source verification, threshold rules, and destination verification belong to later phases.
