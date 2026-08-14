# ADR 0032: OpenTelemetry is the observability boundary

## Status

Accepted (Phase 33)

## Decision

Core uses the official OpenTelemetry JavaScript API for manual spans and metrics. Trace stages cover API, coordinator, adapter, network request, validator, aggregator, destination, and reconciler boundaries. Deployments register SDKs, samplers, processors, and OTLP/Prometheus exporters outside domain packages.

Metrics cover transaction, bridge, attestation, source/destination finality, validator health/disagreement, ingestion lag, reconciliation mismatch, RPC/Canton errors, and stuck transactions. Attributes use a strict bounded-cardinality allowlist. Tenant IDs, operation IDs, addresses, parties, payloads, signatures, credentials, and exception messages are prohibited.

Dashboards and alerts are source-controlled under `infra/observability`. Safety alerts prioritize reconciliation mismatch, stuck transactions, validator disagreement, and ingestion lag.

## Consequences

Instrumentation remains vendor-neutral and safe when no SDK is registered because the OpenTelemetry API defaults to no-op providers. Deployment configuration controls export destinations and sampling without changing protocol code.
