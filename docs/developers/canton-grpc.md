# Canton Ledger API gRPC transport

`CantonGrpcTransport` is the production transport behind `CantonAdapterClient`. It uses the Canton Ledger API v2 over gRPC for health and version probes, party resolution, command submission, transaction lookup, update streaming, and active-contract queries.

Use the protobuf files shipped with the same Canton/Daml release as the participant. Passing those files at startup keeps the wire contract explicit and avoids silently coupling the SDK to a different Canton release.

```ts
import { CantonAdapterClient, CantonGrpcTransport } from "@interweave/core";

const transport = new CantonGrpcTransport({
  endpoint: "localhost:3901",
  networkId: "IW:NETWORK:canton-local",
  participantId: "app-provider-validator",
  userId: "interweave",
  authorizedParties: [process.env.CANTON_PARTY!],
  token: process.env.CANTON_LEDGER_API_TOKEN,
  proto: {
    files: [
      "/opt/canton/protobuf/com/daml/ledger/api/v2/version_service.proto",
      "/opt/canton/protobuf/com/daml/ledger/api/v2/state_service.proto",
      "/opt/canton/protobuf/com/daml/ledger/api/v2/admin/party_management_service.proto",
      "/opt/canton/protobuf/com/daml/ledger/api/v2/command_submission_service.proto",
      "/opt/canton/protobuf/com/daml/ledger/api/v2/update_service.proto"
    ],
    includeDirs: ["/opt/canton/protobuf"]
  }
});

const canton = new CantonAdapterClient(transport, [/* CIP-0056 adapter */]);
await canton.connect();
```

For TLS, supply `tls.rootCert`; for mutual TLS also supply `tls.privateKey` and `tls.certChain`. Bearer tokens are sent as gRPC `authorization` metadata. Every unary and streaming call has a deadline (10 seconds by default, configurable with `deadlineMs`). Call `transport.close()` during application shutdown.

`PreparedCantonTransfer.opaqueCommand` must contain a Ledger API v2 `Commands` message in the object shape produced by `@grpc/proto-loader`. The transport deliberately overwrites `commandId`, `userId`, and `actAs` with the SDK-authorized values so an opaque payload cannot widen its submitting identity or party scope.

The official Ledger API is versioned. When upgrading Canton, run the transport tests against the protobuf files and participant version being promoted before deployment.
