import { expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson, signTap13, verifyTap13Response } from "@emeter/shared";
import type { ServiceCall } from "@emeter/shared";
import type { GatewayContext } from "../src/context.js";
import { builtInServices, buildProvider } from "../src/providers.js";
import { dispatchSignature } from "../src/security.js";

it("reports an unknown completion when result persistence fails after successful execution", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const ctx = {
    config: { container: "0x0000000000000000000000000000000000000001", providerSigner: account.address,
      providerOrigin: "http://127.0.0.1:4110", dispatchSecret: "fixture-dispatch-secret-at-least-32-characters" },
    client: { getBlock: async () => ({ timestamp: BigInt(now) }) },
    db: { providerExecution: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockRejectedValue(new Error("Fixture storage restart")) } }
  } as unknown as GatewayContext;
  const manifest = builtInServices(ctx)["json-validator"]!;
  const app = buildProvider(ctx, account, { model: "fixture", runtime: "offline-fixture", analyze: async () => null });
  const call: ServiceCall = { id: "storage-failure", method: manifest.method, params: {
    sessionId: "fixture-session", serviceId: manifest.serviceId, priceVersion: 1, input: { json: '{"value":1}' }
  } };
  const path = "/services/json-validator/json_validate", timestamp = String(now);
  const response = await app.inject({ method: "POST", url: path, payload: canonicalJson(call), headers: {
    "content-type": "application/json", "x-emeter-timestamp": timestamp,
    "x-emeter-dispatch": dispatchSignature(ctx.config.dispatchSecret, path, timestamp, call)
  } });
  expect(response.statusCode).toBe(503);
  const verified = await verifyTap13Response({ call, container: manifest.container, signer: account.address,
    httpStatus: response.statusCode, body: response.body, now });
  expect(verified.outcome).toBe("accepted_error");
  expect(verified.envelope?.error?.data?.completion).toBe("unknown");
  expect(verified.envelope?.id).toBe(call.id);
  expect(ctx.db.providerExecution.update).toHaveBeenCalledTimes(1);
  await app.close();
});

it("keeps malformed JSON distinct from a provider storage failure", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const ctx = { config: { container: "0x0000000000000000000000000000000000000001", providerSigner: account.address,
    providerOrigin: "http://127.0.0.1:4110", dispatchSecret: "fixture-dispatch-secret-at-least-32-characters" },
    client: { getBlock: async () => ({ timestamp: BigInt(now) }) } } as unknown as GatewayContext;
  const app = buildProvider(ctx, account, { model: "fixture", runtime: "offline-fixture", analyze: async () => null });
  const response = await app.inject({ method: "POST", url: "/services/json-validator/json_validate",
    headers: { "content-type": "application/json" }, payload: '{"id":"a","id":"b"}' });
  expect(response.statusCode).toBe(400);
  const verified = await verifyTap13Response({ call: { id: "a", method: "json_validate", params: {} },
    container: ctx.config.container, signer: account.address, httpStatus: response.statusCode, body: response.body, now });
  expect(verified.outcome).toBe("own_request_malformed");
  await app.close();
});
