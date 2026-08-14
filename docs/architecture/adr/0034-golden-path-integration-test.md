# ADR 0034: Golden path is an executable supply proof

## Status

Accepted (Phase 35)

## Decision

The canonical golden path is an automated 18-step integration scenario. It creates and binds Alice's Canton and EVM identities, issues 1,000 units on Canton, locks and represents 100 units on EVM, burns and releases 40 units, and independently assesses every finalized supply effect.

The terminal assertion requires both EVM representation supply and Canton locked backing to equal 60. The test also requires representation supply to be less than or equal to verified backing and verifies the complete Canton distribution: 940 circulating plus 60 locked equals the original 1,000.

GitHub Actions runs this scenario explicitly before the complete regression suite. This makes the principal product claim visible as its own CI result while retaining all lower-level security and failure tests.

## Consequences

Changes to identities, attestations, bridge accounting, or reconciliation cannot silently break the main user journey. Phase 36 extends this successful baseline with failure injection after each meaningful transition.
