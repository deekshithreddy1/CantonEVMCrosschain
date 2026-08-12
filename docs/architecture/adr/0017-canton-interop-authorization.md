# ADR 0017: Canton interoperability authorization and consumption

Status: Accepted (Phase 16)

## Decision

Canton interoperability state is modeled as consuming Daml workflows. A bridge intent is jointly signed by the asset owner and workflow operator. Locking consumes the intent and creates a `LockedAsset`. Release authorization consumes that locked state only after the operator fetches a validator-signed `AttestationRecord` and verifies operation, asset, amount, receiver, destination, threshold status, and validity. The owner consumes the resulting `ReleaseAuthorization` to create the final released-state record.

Owner/operator joint signatories ensure neither can manufacture or release backing alone. Validator operators are signatories of attestation records. Receivers are observers where they require visibility; unrelated parties are not disclosed workflow state. Consuming choices provide ledger-native one-time execution and prevent duplicate authorization/release.

Token holdings use an opaque standard reference supporting CIP-0056 and a future CIP-0112 boundary. Concrete Token Standard package IDs, interfaces, allocation, and transfer execution remain adapter concerns until integration against an actual Canton environment.

## Consequences

The Daml model enforces workflow authorization and privacy structure but does not yet lock or release a live Canton Token Standard holding. Production also requires Ledger API authentication, package vetting, topology/party hosting configuration, and integration tests on LocalNet/DevNet. Sandbox script authorization is not a substitute for API access control.
