# `@interweave/sdk`

Typed TypeScript client for the InterWeave `/v1` API.

```ts
import { InterWeave } from "@interweave/sdk";

const iw = new InterWeave({ apiKey: process.env.INTERWEAVE_API_KEY! });

const asset = await iw.assets.get("IW:ASSET:bond");
const transaction = await iw.bridge.move({
  assetId: asset.id,
  sourceNetworkId: "IW:NETWORK:canton",
  destinationNetworkId: "IW:NETWORK:ethereum",
  sender: "IW:IDENTITY:alice",
  receiver: "IW:IDENTITY:bob",
  amount: "100",
  expiresAt: new Date(Date.now() + 300_000).toISOString()
});
```

Write methods generate idempotency keys automatically. Pass `{ idempotencyKey: "..." }` when the key must be stable across process restarts. Ordinary methods return network-neutral domain data; `iw.raw.request(...)` is the explicit low-level surface for response metadata.
