import { expect, it } from "vitest";
import { buildGateway } from "../src/app.js";
import type { GatewayContext } from "../src/context.js";

it("reports protocol phase without claiming paid execution", async () => {
  const app = buildGateway();
  const response = await app.inject({ method: "GET", url: "/api/protocol" });
  expect(response.json()).toMatchObject({ chainId: 196, paidExecutionReady: false, mainnetProofVerified: false });
  await app.close();
});

it("refuses execution while the billing product is unimplemented", async () => {
  const app = buildGateway();
  const response = await app.inject({ method: "POST", url: "/api/execute/text-analyzer", payload: { text: "example" } });
  expect(response.statusCode).toBe(503);
  expect(response.json().error).toBe("PAID_EXECUTION_NOT_READY");
  await app.close();
});

const browserContext = () => ({ config: {
  gatewayOrigin: "http://127.0.0.1:4100", browserOrigins: ["http://127.0.0.1:3100"],
  vault: "0x0000000000000000000000000000000000000001", registry: "0x0000000000000000000000000000000000000002",
  token: "0x0000000000000000000000000000000000000003", rpcUrl: "http://127.0.0.1:8545", confirmations: 1, networkMode: "local-fork"
}, client: { getBlock: async () => ({ number: 100n, hash: "0x" + "1".repeat(64), timestamp: 123n }) } }) as unknown as GatewayContext;

it("publishes a block anchor and CORS headers for an explicitly configured browser", async () => {
  const app = buildGateway({ context: browserContext() });
  const response = await app.inject({ method: "GET", url: "/api/protocol", headers: { origin: "http://127.0.0.1:3100" } });
  expect(response.statusCode).toBe(200);
  expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
  expect(response.json().anchor).toEqual({ blockNumber: "100", blockHash: "0x" + "1".repeat(64), timestamp: "123" });
  await app.close();
});
it("allows scoped authorization headers in browser preflight", async () => {
  const app = buildGateway({ context: browserContext() });
  const response = await app.inject({ method: "OPTIONS", url: "/api/execute/json-validator", headers: { origin: "http://127.0.0.1:3100", "access-control-request-headers": "authorization,content-type" } });
  expect(response.statusCode).toBe(204);
  expect(response.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
  await app.close();
});
it("rejects unconfigured browser origins before any wallet route", async () => {
  const app = buildGateway({ context: browserContext() });
  const response = await app.inject({ method: "GET", url: "/api/protocol", headers: { origin: "https://unconfigured.example" } });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: "ORIGIN_NOT_ALLOWED" });
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  await app.close();
});
