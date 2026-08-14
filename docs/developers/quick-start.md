# Quick Start

## What it is

This is the shortest route from a clean checkout to an authenticated SDK request and the local Canton-to-EVM golden path.

## Why it exists

InterWeave spans databases, validators, Canton, and EVM. A reproducible start prevents developers from accidentally testing only an in-memory happy path.

## Example

```bash
npm ci
npm run check
npm test
docker compose up --build
npm run test:golden-path
```

For the production-shaped Digital Asset validator topology, follow [local development](../local-development.md) and run `npm run canton-localnet:prepare` before starting the official LocalNet yourself.

```ts
import { InterWeave } from "@interweave/sdk";
const client = new InterWeave({ baseUrl: "http://localhost:8080", apiKey: process.env.INTERWEAVE_API_KEY! });
const networks = await client.networks.list();
```

## Failure cases

Docker may lack memory, ledger services may still be unhealthy, credentials may be absent, or a write may time out after acceptance. Never retry a write with a new idempotency key until its original status is known.

## API usage

Use `Authorization: Bearer …` and `Idempotency-Key` on every write. Read `x-request-id` and persist returned InterWeave IDs for support and audit reconstruction.
