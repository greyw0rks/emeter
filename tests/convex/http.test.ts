import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import schema from "../../convex/schema";
import { createConvexDatabase } from "../../convex/lib/database";
import type { ActionCtx } from "../../convex/_generated/server";

vi.mock("../../convex/lib/runtime", async () => {
  const { verifyMessage } = await import("viem");
  const { createConvexDatabase } = await import("../../convex/lib/database");
  const original = (await import("../../deployments/xlayer-196.json")).default;
  const engine = (await import("../../deployments/xlayer-196-engine.json")).default;
  const config = { gatewayOrigin: "https://first-eel-292.convex.site", providerOrigin: "https://first-eel-292.convex.site",
    browserOrigins: ["https://emeter.test"], executionEnabled: false, chainId: 196, vault: engine.contracts.vault,
    registry: engine.contracts.registry, token: original.contracts.demoToken, adapter: original.contracts.adapter,
    container: original.contracts.serviceContainer, rpcUrl: "https://rpc.xlayer.tech", confirmations: 3, networkMode: "mainnet" };
  return { runtimeConfig: () => config, signer: () => { throw new Error("UNUSED"); }, createRuntimeContext: async (ctx: ActionCtx) => ({ config,
    db: createConvexDatabase(ctx), client: { verifyMessage, readContract: async () => 0n, getBalance: async () => 0n,
      getBlock: async () => ({ number: 10n, hash: "0x" + "1".repeat(64), timestamp: BigInt(Math.floor(Date.now()/1000)) }) },
    sessions: {}, executionQueue: {}, settlementQueue: {}, close: async () => undefined }) };
});
const modules = import.meta.glob("../../convex/**/*.{ts,js}");
afterEach(() => vi.unstubAllEnvs());
async function login(t: ReturnType<typeof convexTest>) {
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await (await t.fetch("/api/auth/challenge", { method: "POST", body: JSON.stringify({ wallet: account.address }) })).json();
  const signature = await account.signMessage({ message: challenge.message });
  const body = { id: challenge.id, signature };
  const response = await t.fetch("/api/auth/verify", { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  return { account, body, token: (await response.json()).token as string };
}
it("returns credentials once, stores only hashes, and rejects challenge replay", async () => {
  const t = convexTest(schema, modules), { account, body, token } = await login(t);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const response = await t.fetch("/api/account", { headers: { authorization: "Bearer " + token } });
  expect(response.status).toBe(200);
  expect((await response.json()).wallet).toBe(account.address.toLowerCase());
  expect((await t.fetch("/api/auth/verify", { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
  const stored = await t.run(ctx => ctx.db.query("records").collect());
  expect(JSON.stringify(stored)).not.toContain(token);
  const hash = stored.find(row => row.model === "authSession")!.data.tokenHash;
  expect((await t.fetch("/api/account", { headers: { "x-emeter-credential-hash": hash } })).status).toBe(401);
});
it("preserves provider credential scope and revocation", async () => {
  const t = convexTest(schema, modules), { account, token } = await login(t);
  const db = createConvexDatabase({ runQuery: (fn: any,args: any) => t.query(fn,args), runMutation: (fn: any,args: any) => t.mutation(fn,args) } as ActionCtx);
  const serviceId = "0x" + "2".repeat(64);
  await db.service.create({ data: { id: serviceId, provider: account.address.toLowerCase(), name: "JSON Validator", description: "", method: "json_validate", endpoint: "https://first-eel-292.convex.site/services/json-validator", manifest: {} } });
  const response = await t.fetch("/api/keys", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify({ serviceId, scopes: ["usage:read"] }) });
  expect(response.status).toBe(200);
  const key = await response.json();
  expect(key.key).toMatch(/^emeter_[A-Za-z0-9_-]{43}$/);
  expect((await t.fetch("/api/dashboard/usage", { headers: { authorization: "Bearer " + key.key } })).status).toBe(200);
  expect((await t.fetch("/api/account", { headers: { authorization: "Bearer " + key.key } })).status).toBe(401);
  expect((await t.fetch("/api/keys/" + key.id, { method: "DELETE", headers: { authorization: "Bearer " + token } })).status).toBe(200);
  expect((await t.fetch("/api/dashboard/usage", { headers: { authorization: "Bearer " + key.key } })).status).toBe(401);
  expect(JSON.stringify(await t.run(ctx => ctx.db.query("records").collect()))).not.toContain(key.key);
});
it("rejects unconfigured origins and duplicate JSON before issuing a grant", async () => {
  vi.stubEnv("EMETER_BROWSER_ORIGINS", "https://emeter.test");
  const t = convexTest(schema, modules), account = privateKeyToAccount(generatePrivateKey());
  const preflight = await t.fetch("/api/auth/challenge", { method: "OPTIONS", headers: { origin: "https://emeter.test" } });
  expect(preflight.status).toBe(204); expect(preflight.headers.get("access-control-allow-origin")).toBe("https://emeter.test");
  expect((await t.fetch("/api/auth/challenge", { method: "POST", headers: { origin: "https://unconfigured.test" }, body: JSON.stringify({ wallet: account.address }) })).status).toBe(403);
  expect((await t.fetch("/api/auth/challenge", { method: "POST", body: '{"wallet":"' + account.address + '","wallet":"' + account.address + '"}' })).status).toBe(400);
  expect((await t.run(ctx => ctx.db.query("records").collect())).length).toBe(0);
});
