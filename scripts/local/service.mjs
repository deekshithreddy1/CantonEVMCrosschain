import { createServer } from "node:http";

const role = process.env.INTERWEAVE_ROLE ?? "service";
const instance = process.env.INSTANCE_ID ?? role;
const port = Number(process.env.PORT ?? 8080);
const required = ["DATABASE_URL", "NATS_URL", "CANTON_LEDGER_URL", "EVM_RPC_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`missing local configuration: ${missing.join(", ")}`);

const server = createServer((request, response) => {
  if (request.url !== "/healthz" && request.url !== "/readyz") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "ready", role, instance, environment: "local" }));
});
server.listen(port, "0.0.0.0", () => console.log(`${instance} ready on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
