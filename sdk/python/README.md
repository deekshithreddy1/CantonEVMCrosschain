# InterWeave Python SDK

```python
from interweave import InterWeave
iw = InterWeave(api_key="...")
asset = iw.assets.get("IW:ASSET:bond")
operation = iw.bridge.move({...})
```

The dependency-free client mirrors the TypeScript resource methods, idempotency behavior, typed API errors, HTTPS policy, and explicit `raw_request` metadata escape hatch.
