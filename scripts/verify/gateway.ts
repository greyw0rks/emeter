import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import type { Hex } from "viem";
import { EmeterClient } from "@emeter/sdk";
import {
  canonicalJson, emeterRegistryAbi, emeterVaultAbi, fromWireCharge, jsonSafe, manifestHash,
  requestHash, signTap13, verifyTap13Response, ZERO_BYTES32
} from "@emeter/shared";
import type { JsonValue, ServiceCall, ServiceManifest } from "@emeter/shared";
import { createGatewayHarness } from "../../apps/gateway/test/harness.js";
import type { GatewayHarness } from "../../apps/gateway/test/harness.js";
import type { Prisma } from "../../packages/database/src/index.js";
import { executeRequest } from "../../apps/gateway/src/execution.js";
import { indexChain, rebuildIndexer } from "../../apps/gateway/src/indexer.js";
import { reserveRequest } from "../../apps/gateway/src/requests.js";
import { dispatchSignature, secretHash } from "../../apps/gateway/src/security.js";
import { settleRequest } from "../../apps/gateway/src/settlement.js";
import { expireReservations } from "../../apps/gateway/src/worker.js";
import { verifyAiEvidence } from "@emeter/shared";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checks: string[] = [];
let activeCheck = "bootstrap";
const startedAt = new Date().toISOString();
const sourceFiles = ["apps/gateway/src/app.ts", "apps/gateway/src/auth.ts", "apps/gateway/src/requests.ts", "apps/gateway/src/execution.ts",
  "apps/gateway/src/providers.ts", "apps/gateway/src/ai.ts", "apps/gateway/src/settlement.ts", "apps/gateway/src/indexer.ts",
  "apps/gateway/src/worker.ts", "packages/shared/src/gateway.ts", "packages/shared/src/ai-receipt.ts",
  "packages/sdk/src/client.ts", "packages/sdk/src/session-client.ts", "packages/database/prisma/schema.prisma"];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async path =>
  [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function check(name: string, work: () => Promise<void>) {
  activeCheck = name; await work(); checks.push(name); console.log("PASS " + name);
}
async function eventually(work: () => Promise<boolean>, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await work()) return; await sleep(250); }
  throw new Error("Timed out waiting for " + activeCheck);
}
async function post(h: GatewayHarness, path: string, body: unknown, token?: string) {
  return fetch(h.ctx.config.gatewayOrigin + path, { method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: canonicalJson(jsonSafe(body)), signal: AbortSignal.timeout(35_000) });
}
type Session = Awaited<ReturnType<GatewayHarness["makeSession"]>>;
async function payload(h: GatewayHarness, session: Session, manifest: ServiceManifest, input: JsonValue,
  nonce = BigInt("0x" + randomUUID().replace(/-/g, "")), cap = "50000") {
  const id = randomUUID();
  const version = (await h.ctx.sessions.getQuote(manifest.serviceId)).priceVersion;
  const call: ServiceCall = { id, method: manifest.method, params: {
    sessionId: session.id, serviceId: manifest.serviceId, priceVersion: version, input
  } };
  const prepared = await h.ctx.sessions.prepareCharge({ sessionId: session.id, serviceId: manifest.serviceId,
    priceVersion: version, requestId: keccak256(toHex(id)), requestHash: requestHash(call), nonce, maxAmount: BigInt(cap) });
  const signed = await h.ctx.sessions.signCharge(prepared, session.delegate);
  return { call, authorization: jsonSafe(signed.authorization), signature: signed.signature };
}
async function providerPost(h: GatewayHarness, call: ServiceCall, manifest: ServiceManifest) {
  const path = new URL(manifest.endpoint).pathname + "/" + call.method;
  const ts = String(Math.floor(Date.now() / 1000));
  return h.provider.inject({ method: "POST", url: path, payload: canonicalJson(call), headers: {
    "content-type": "application/json", "x-emeter-timestamp": ts,
    "x-emeter-dispatch": dispatchSignature(h.ctx.config.dispatchSecret, path, ts, call)
  } });
}

let harness: GatewayHarness | undefined;
try {
  const h = harness = await createGatewayHarness();
  const json = h.manifests["json-validator"]!, ai = h.manifests["text-analyzer"]!;
  const input = { json: '{"name":"emeter","requests":3}', schema: {
    type: "object", properties: { name: { type: "string" }, requests: { type: "integer", minimum: 0 } }, required: ["name", "requests"]
  } };
  await check("existing engine and real TapeOut circuit on an isolated X Layer fork", async () => {
    assert.equal(await h.client.getChainId(), 196);
    assert.equal(h.ctx.config.networkMode, "local-fork");
    assert.equal(new URL(h.ctx.config.rpcUrl).hostname, "127.0.0.1");
    assert.notEqual(await h.client.getCode({ address: h.ctx.config.vault }), "0x");
    assert.equal(await h.client.readContract({ address: h.ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]),
      functionName: "isAllowed", args: [31] }), true);
    assert.equal(await h.client.readContract({ address: h.ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]),
      functionName: "isAllowed", args: [15] }), false);
  });
  await check("verified service registration and immutable metadata", async () => {
    const services = await h.providerClient.getServices();
    assert.equal(services.length, 2);
    for (const service of services) {
      const quote = await h.ctx.sessions.getQuote(service.id);
      assert.equal(manifestHash(service.manifest).toLowerCase(), quote.metadataHash.toLowerCase());
    }
  });
  await check("execution, settlement, and indexer workers become ready", async () => { await h.start(); });
  activeCheck = "first customer fixture";
  const first = await h.makeSession();
  let firstResult: Awaited<ReturnType<typeof first.agent.execute>>;
  const firstId = randomUUID();
  await check("wallet authentication consumes one challenge under concurrent replay", async () => {
    const challengeResponse = await post(h, "/api/auth/challenge", { wallet: first.customer.address });
    const challenge = await challengeResponse.json() as { id: string; message: string };
    const signature = await first.customer.signMessage({ message: challenge.message });
    const before = await h.ctx.db.authSession.count({ where: { wallet: first.customer.address.toLowerCase() } });
    const replies = await Promise.all([post(h, "/api/auth/verify", { id: challenge.id, signature }),
      post(h, "/api/auth/verify", { id: challenge.id, signature })]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 401]);
    assert.equal(await h.ctx.db.authSession.count({ where: { wallet: first.customer.address.toLowerCase() } }), before + 1);
  });
  await check("scoped API keys are stored as hashes and cannot mint new keys", async () => {
    const row = await h.ctx.db.aPIKey.findUniqueOrThrow({ where: { id: first.key.id } });
    assert.equal(row.keyHash, secretHash(first.key.key));
    assert.notEqual(row.keyHash, first.key.key);
    assert.equal(row.sessionId, first.id);
    assert.equal((await post(h, "/api/keys", { sessionId: first.id, scopes: ["execute"] }, first.key.key)).status, 401);
  });
  await check("SDK executes JSON validation and independently confirms settlement", async () => {
    firstResult = await first.agent.execute({ serviceId: "json-validator", input, maxCharge: "0.05", requestId: firstId });
    assert.equal(firstResult.requestStatus, "completed"); assert.equal(firstResult.paymentStatus, "settled");
    assert.equal(firstResult.receiptVerified, true); assert.equal(firstResult.settlementVerified, true);
    assert.equal(firstResult.priceBaseUnits, "20000"); assert.equal(firstResult.policyInputs, 31);
    assert.equal((firstResult.data as { valid: boolean }).valid, true);
  });
  await check("duplicate SDK execute recovers the original nonce and payment", async () => {
    const again = await first.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: firstId });
    assert.equal(again.requestId, firstResult!.requestId);
    assert.equal(again.authorization.nonce, firstResult!.authorization.nonce);
    assert.equal(again.transaction?.hash, firstResult!.transaction?.hash);
    assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: again.requestId } }), 1);
    assert.equal(await h.ctx.db.providerExecution.count({ where: { id: again.requestId } }), 1);
    await assert.rejects(first.agent.execute({ serviceId: json.serviceId, input: { json: "[]" },
      maxCharge: "0.05", requestId: firstId }), /IDEMPOTENCY_CONFLICT/);
  });
  await check("SDK refuses gateway data that disagrees with the signed provider result", async () => {
    const changedFetch: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).includes("/api/requests/") && response.ok) {
        const value = await response.json() as Record<string, unknown>;
        value.data = { valid: false, errors: [] };
        return new Response(JSON.stringify(value), { status: response.status });
      }
      return response;
    };
    const client = new EmeterClient({ gatewayUrl: h.ctx.config.gatewayOrigin, rpcUrl: h.ctx.config.rpcUrl,
      vault: h.ctx.config.vault, registry: h.ctx.config.registry, sessionId: first.id, token: first.key.key, fetch: changedFetch });
    await assert.rejects(client.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: firstId }), /receipt verification/);
  });
  await check("SDK refuses a fabricated settlement hash with a valid signed result", async () => {
    const changedFetch: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).includes("/api/requests/") && response.ok) {
        const value = await response.json() as { transaction: { hash: string } };
        value.transaction.hash = ZERO_BYTES32;
        return new Response(JSON.stringify(value), { status: response.status });
      }
      return response;
    };
    const client = new EmeterClient({ gatewayUrl: h.ctx.config.gatewayOrigin, rpcUrl: h.ctx.config.rpcUrl,
      vault: h.ctx.config.vault, registry: h.ctx.config.registry, sessionId: first.id, token: first.key.key, fetch: changedFetch });
    await assert.rejects(client.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: firstId }));
  });
  await check("strict outer JSON and origin checks reject calls before reservation", async () => {
    const invalid = await h.gateway.inject({ method: "POST", url: "/api/execute/" + json.serviceId,
      headers: { authorization: "Bearer " + first.key.key, "content-type": "application/json" }, payload: '{"call":{},"call":{}}' });
    assert.equal(invalid.statusCode, 400);
    const foreign = await h.gateway.inject({ method: "GET", url: "/api/protocol", headers: { origin: "https://other.example" } });
    assert.equal(foreign.statusCode, 403);
    assert.equal((await h.gateway.inject({ method: "GET", url: "/api/requests/" + firstResult!.requestId })).statusCode, 401);
  });
  const other = await h.makeSession();
  await check("session credentials cannot read or execute another customer's session", async () => {
    const body = await payload(h, other, json, input);
    assert.equal((await post(h, "/api/execute/" + json.serviceId, body, first.key.key)).status, 403);
    assert.equal((await h.gateway.inject({ method: "GET", url: "/api/sessions/" + other.id,
      headers: { authorization: "Bearer " + first.key.key } })).statusCode, 404);
  });
  await check("service credentials expose scoped analytics and cannot execute", async () => {
    const key = await h.providerClient.createApiKey({ serviceId: json.serviceId, scopes: ["usage:read", "request:read"] });
    const sdk = new EmeterClient({ gatewayUrl: h.ctx.config.gatewayOrigin, token: key.key });
    const usage = await sdk.getUsage() as { services: { id: string }[]; settledRequests: number };
    assert.equal(usage.services.length, 1); assert.equal(usage.services[0]!.id, json.serviceId); assert.equal(usage.settledRequests, 1);
    const body = await payload(h, first, json, input);
    assert.equal((await post(h, "/api/execute/" + json.serviceId, body, key.key)).status, 401);
  });
  await check("API key expiry and revocation are enforced", async () => {
    const key = await first.sdk.createApiKey({ sessionId: first.id, scopes: ["request:read"] });
    await h.ctx.db.aPIKey.update({ where: { id: key.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await h.gateway.inject({ method: "GET", url: "/api/requests/" + firstResult!.requestId,
      headers: { authorization: "Bearer " + key.key } })).statusCode, 401);
    await first.sdk.revokeApiKey(key.id);
    assert.notEqual((await h.ctx.db.aPIKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null);
  });
  await check("successful negative JSON validation is billed, unsupported schema errors are not", async () => {
    const negative = await first.agent.execute({ serviceId: json.serviceId, input: { json: '{"broken":' }, maxCharge: "0.05" });
    assert.equal((negative.data as { valid: boolean }).valid, false); assert.equal(negative.settlementVerified, true);
    const failed = await first.agent.execute({ serviceId: json.serviceId,
      input: { json: '"x"', schema: { type: "string", pattern: ".*" } }, maxCharge: "0.05" });
    assert.equal(failed.requestStatus, "failed"); assert.equal(failed.paymentStatus, "unsubmitted");
    assert.equal(failed.receiptVerified, true); assert.equal(failed.settlementVerified, false);
    assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: failed.requestId } }), 0);
  });
  const scoped = await h.makeSession({ serviceIds: [json.serviceId] });
  await check("delegated signatures cannot escape their service scope", async () => {
    const before = h.counters.fixtureAi;
    await assert.rejects(scoped.agent.execute({ serviceId: ai.serviceId, input: { text: "A test." }, maxCharge: "0.05" }), /scope/);
    assert.equal(h.counters.fixtureAi, before);
  });
  await h.stop();
  const concurrent = await h.makeSession({ budget: 40_000n, serviceIds: [json.serviceId] });
  await check("PostgreSQL session locks prevent concurrent budget oversubscription", async () => {
    const bodies = await Promise.all([1n, 2n, 3n].map(n => payload(h, concurrent, json, input, n, "20000")));
    const rows = await Promise.allSettled(bodies.map(body => reserveRequest(h.ctx, concurrent.customer.address.toLowerCase(), json.serviceId, body)));
    assert.equal(rows.filter(row => row.status === "fulfilled").length, 2);
    assert.equal(rows.filter(row => row.status === "rejected").length, 1);
    const saved = await h.ctx.db.aPIRequest.findMany({ where: { sessionId: concurrent.id, reservationActive: true } });
    assert.equal(saved.reduce((sum, row) => sum + BigInt(row.amount.toFixed(0)), 0n), 40_000n);
    for (const row of saved) await executeRequest(h.ctx, row.id);
  });
  await h.start();
  await eventually(async () => await h.ctx.db.aPIRequest.count({ where: { sessionId: concurrent.id, paymentStatus: "settled" } }) === 2);
  await check("invalid request signatures and a reserved nonce are rejected before service execution", async () => {
    const body = await payload(h, first, json, input, 77n);
    const wrong = await other.delegate.signMessage({ message: "Wrong signing domain" });
    await assert.rejects(reserveRequest(h.ctx, first.customer.address.toLowerCase(), json.serviceId, { ...body, signature: wrong }), /INVALID_SESSION_SIGNATURE/);
    const row = await reserveRequest(h.ctx, first.customer.address.toLowerCase(), json.serviceId, body);
    const conflict = await payload(h, first, json, input, 77n);
    await assert.rejects(reserveRequest(h.ctx, first.customer.address.toLowerCase(), json.serviceId, conflict), /REQUEST_NONCE_RESERVED/);
    await executeRequest(h.ctx, row.id);
  });
  await eventually(async () => (await h.ctx.db.aPIRequest.findFirst({ where: { sessionId: first.id, nonce: "77" } }))?.paymentStatus === "settled");
  await check("provider request-id caching survives a provider process restart", async () => {
    const before = h.counters.fixtureAi;
    const body = await payload(h, first, ai, { text: "A fixture paragraph." });
    const response = await providerPost(h, body.call, ai);
    assert.equal(response.statusCode, 200); assert.equal(h.counters.fixtureAi, before + 1);
    await h.restartProvider();
    const cached = await providerPost(h, body.call, ai);
    assert.deepEqual(cached.json(), response.json()); assert.equal(h.counters.fixtureAi, before + 1);
    const changed: ServiceCall = { ...body.call, params: { ...body.call.params, input: { text: "A different paragraph." } } };
    const refused = await providerPost(h, changed, ai);
    assert.equal(refused.statusCode, 400); assert.equal(h.counters.fixtureAi, before + 1);
  });
  await check("paid fixture AI results include verified raw-byte and usage receipts", async () => {
    const result = await first.agent.execute({ serviceId: ai.serviceId, input: { text: "Controlled offline fixture." }, maxCharge: "0.05" });
    assert.equal(result.receiptVerified, true); assert.equal(result.settlementVerified, true);
    assert.equal((result.data as { model: { runtime: string } }).model.runtime, "offline-fixture");
    assert.notEqual(result.receipt?.aiReceipt, null);
  });
  await h.stop();
  const versioned = await h.makeSession();
  const versionedBody = await payload(h, versioned, json, input);
  await reserveRequest(h.ctx, versioned.customer.address.toLowerCase(), json.serviceId, versionedBody);
  await check("in-flight gateway requests preserve their signed price version after a price change", async () => {
    await h.send(h.providerAccount, h.ctx.config.registry, encodeFunctionData({ abi: emeterRegistryAbi, functionName: "publishPriceVersion",
      args: [json.serviceId, json.payout, json.signer, json.container, 30_000n, keccak256(toHex("unverified new manifest"))] }));
    assert.equal((await h.providerClient.getServices()).filter(service => service.id === json.serviceId).length, 0);
    await executeRequest(h.ctx, fromWireCharge(versionedBody.authorization).requestId);
    await h.send(h.providerAccount, h.ctx.config.registry, encodeFunctionData({ abi: emeterRegistryAbi, functionName: "publishPriceVersion",
      args: [json.serviceId, json.payout, json.signer, json.container, 20_000n, manifestHash(json)] }));
    assert.equal((await h.providerClient.registerService(json, 3) as { status: string }).status, "registered");
    assert.equal((await h.ctx.sessions.getQuote(json.serviceId, 1)).price, 20_000n);
    assert.equal((await h.ctx.sessions.getQuote(json.serviceId, 2)).price, 30_000n);
  });
  await h.start();
  await check("historical SDK recovery verifies the old version without signing another charge", async () => {
    const result = await versioned.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: versionedBody.call.id });
    assert.equal(result.priceVersion, 1); assert.equal(result.priceBaseUnits, "20000"); assert.equal(result.settlementVerified, true);
  });
  await h.stop();
  const soft = await h.makeSession({ budget: 100_000n, softLimit: 30_000n });
  const held = await payload(h, soft, json, input);
  const heldId = fromWireCharge(held.authorization).requestId;
  await reserveRequest(h.ctx, soft.customer.address.toLowerCase(), json.serviceId, held);
  await executeRequest(h.ctx, heldId);
  await check("actual circuit denial after external spend preserves output without reporting a payment", async () => {
    const outside = await payload(h, soft, json, input);
    const auth = fromWireCharge(outside.authorization);
    const envelope = await signTap13(outside.call, json.container, { valid: true }, true, Number((await h.client.getBlock()).timestamp), h.providerAccount.signMessage);
    const verified = await verifyTap13Response({ call: outside.call, container: json.container, signer: json.signer,
      httpStatus: 200, body: canonicalJson(envelope), now: envelope.ts });
    assert.ok(verified.receipt);
    await h.send(h.relayer, h.ctx.config.vault, encodeFunctionData({ abi: emeterVaultAbi, functionName: "settle", args: [{
      authorization: auth, chargeSignature: outside.signature, receipt: verified.receipt, providerSignature: envelope.sig,
      softLimitOverride: { sessionId: ZERO_BYTES32, chargeDigest: ZERO_BYTES32, maxTotalSpend: 0n, validUntil: 0n }, customerOverrideSignature: "0x"
    }] }));
    await settleRequest(h.ctx, heldId, h.relayer);
    const row = await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: heldId } });
    assert.equal(row.paymentStatus, "denied"); assert.equal(row.policyInputs, 15); assert.equal(row.reservationActive, true);
    assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: heldId } }), 0);
    const result = await soft.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: held.call.id });
    assert.equal(result.receiptVerified, true); assert.equal(result.settlementVerified, false);
  });
  await check("a delegated key cannot authorize its own soft-limit override", async () => {
    const state = await h.ctx.sessions.getSession(soft.id);
    const grant = await h.ctx.sessions.signOverride(fromWireCharge(held.authorization), 40_000n, state.refundAfter, soft.delegate);
    await assert.rejects(soft.sdk.requestSettlement(heldId, { ...grant.authorization, signature: grant.signature }), /INVALID_CUSTOMER_OVERRIDE/);
  });
  await check("a separate customer override authorizes the same retained charge", async () => {
    const state = await h.ctx.sessions.getSession(soft.id);
    const grant = await h.ctx.sessions.signOverride(fromWireCharge(held.authorization), 40_000n, state.refundAfter, soft.customer);
    await soft.sdk.requestSettlement(heldId, { ...grant.authorization, signature: grant.signature });
    await h.start();
    await eventually(async () => (await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: heldId } })).paymentStatus === "settled");
    const result = await soft.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: held.call.id });
    assert.equal(result.policyInputs, 47); assert.equal(result.settlementVerified, true);
    assert.equal(result.authorization.nonce, fromWireCharge(held.authorization).nonce.toString());
  });
  const uncertain = await h.makeSession({ budget: 20_000n, serviceIds: [json.serviceId] });
  const uncertainBody = await payload(h, uncertain, json, input, 0n, "20000");
  const uncertainId = fromWireCharge(uncertainBody.authorization).requestId;
  await h.ctx.db.providerExecution.create({ data: { id: uncertainId, requestHash: requestHash(uncertainBody.call), status: "processing" } });
  await check("an interrupted provider completion remains indeterminate with its budget reserved", async () => {
    assert.equal((await post(h, "/api/execute/" + json.serviceId, uncertainBody, uncertain.key.key)).status, 202);
    await eventually(async () => (await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: uncertainId } })).requestStatus === "indeterminate");
    assert.equal((await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: uncertainId } })).reservationActive, true);
    assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: uncertainId } }), 0);
    await assert.rejects(uncertain.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.02" }), /SESSION_BUDGET_RESERVED/);
  });
  await check("recovery retrieves the persisted provider result using the original request and nonce", async () => {
    const envelope = await signTap13(uncertainBody.call, json.container, { valid: true, errors: [] }, true,
      Number((await h.client.getBlock()).timestamp), h.providerAccount.signMessage);
    await h.ctx.db.providerExecution.update({ where: { id: uncertainId }, data: { status: "completed", envelope: jsonSafe(envelope) as Prisma.InputJsonValue } });
    await uncertain.sdk.recoverRequest(uncertainId);
    const result = await uncertain.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.02", requestId: uncertainBody.call.id });
    assert.equal(result.requestId, uncertainId); assert.equal(result.authorization.nonce, "0"); assert.equal(result.settlementVerified, true);
    assert.equal(await h.ctx.db.aPIRequest.count({ where: { id: uncertainId } }), 1);
  });
  const reorg = await h.makeSession();
  const storageFault = await h.makeSession({ budget: 20_000n, serviceIds: [json.serviceId] });
  const storageBody = await payload(h, storageFault, json, input, 0n, "20000");
  const storageId = fromWireCharge(storageBody.authorization).requestId;
  await check("a post-execution persistence failure retains the reservation as an unknown completion", async () => {
    const actualDb = h.ctx.db;
    const delegate = actualDb.providerExecution;
    const faulted = new Proxy(delegate, { get(target, property, receiver) {
      if (property === "update") return (args: Prisma.ProviderExecutionUpdateArgs) => {
        if (args.where.id === storageId) return Promise.reject(new Error("Fixture persistence interruption"));
        return delegate.update(args);
      };
      return Reflect.get(target, property, receiver);
    } });
    h.ctx.db = new Proxy(actualDb, { get(target, property, receiver) {
      return property === "providerExecution" ? faulted : Reflect.get(target, property, receiver);
    } });
    try {
      assert.equal((await post(h, "/api/execute/" + json.serviceId, storageBody, storageFault.key.key)).status, 202);
      await eventually(async () => (await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: storageId } })).requestStatus === "indeterminate");
      assert.equal((await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: storageId } })).reservationActive, true);
      assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: storageId } }), 0);
    } finally { h.ctx.db = actualDb; }
  });
  await h.stop();
  await h.test.mine({ blocks: 2 });
  await indexChain(h.ctx);
  const snapshot = await h.test.snapshot();
  await h.start();
  const balanceBefore = await h.client.readContract({ address: h.ctx.config.token, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]),
    functionName: "balanceOf", args: [h.providerAccount.address] });
  const reorgId = randomUUID();
  const originalResult = await reorg.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: reorgId });
  const originalSettlement = await h.ctx.db.settlement.findUniqueOrThrow({ where: { requestId: originalResult.requestId } });
  await h.stop();
  await check("indexer detects a reorg and stops billing readiness", async () => {
    await h.test.revert({ id: snapshot });
    await assert.rejects(indexChain(h.ctx), /CHAIN_REORG_RECONCILIATION_REQUIRED/);
    const protocol = await reorg.sdk.getProtocolStatus();
    assert.equal(protocol.paidExecutionReady, false);
    assert.equal((await h.ctx.db.indexerCursor.findUniqueOrThrow({ where: { id: h.ctx.config.vault.toLowerCase() } })).state, "reorg_detected");
  });
  await check("indexer rebuild retains signed evidence and reuses the original settlement hash", async () => {
    await h.test.setNextBlockTimestamp({ timestamp: (await h.client.getBlock()).timestamp + 10n });
    await h.test.mine({ blocks: 1 });
    await rebuildIndexer(h.ctx);
    assert.equal((await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: originalResult.requestId } })).paymentStatus, "pending");
    await h.start();
    await eventually(async () => (await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: originalResult.requestId } })).paymentStatus === "settled");
    const recovered = await reorg.agent.execute({ serviceId: json.serviceId, input, maxCharge: "0.05", requestId: reorgId });
    const current = await h.ctx.db.settlement.findUniqueOrThrow({ where: { requestId: recovered.requestId } });
    assert.equal(recovered.transaction?.hash, originalResult.transaction?.hash);
    assert.notEqual(current.blockHash, originalSettlement.blockHash);
    assert.equal(recovered.settlementVerified, true);
    assert.equal(await h.ctx.db.settlementAttempt.count({ where: { requestId: recovered.requestId } }), 1);
    const balance = await h.client.readContract({ address: h.ctx.config.token, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]),
      functionName: "balanceOf", args: [h.providerAccount.address] });
    assert.equal(balance, balanceBefore + 20_000n);
  });
  let liveProof: Record<string, unknown> | null = null;
  if (process.argv.includes("--live-ai")) {
    await check("one real Otari AI request verifies bytes, usage, useful output, and local settlement", async () => {
      const selected = await h.useLiveAi();
      const live = await h.makeSession();
      const result = await live.agent.execute({ serviceId: ai.serviceId,
        input: { text: "Our team launched a tool that validates JSON and gives developers spending limits. Early users like clear receipts, but setup still needs improvement." },
        maxCharge: "0.05" });
      if (result.requestStatus !== "completed") {
        const provider = await h.ctx.db.providerExecution.findUnique({ where: { id: result.requestId } });
        const envelope = provider?.envelope as { ok?: boolean; error?: { data?: unknown }; result?: { usageEvidence?: unknown; analysis?: unknown } } | null;
        console.error(JSON.stringify({ requestStatus: result.requestStatus, paymentStatus: result.paymentStatus,
          gatewayError: result.error, providerFailure: envelope?.error?.data ?? null }));
        if (envelope?.ok && envelope.result?.usageEvidence) {
          try { await verifyAiEvidence(envelope.result.usageEvidence, { container: ai.container, signer: ai.signer,
            analysis: envelope.result.analysis }); }
          catch (error) { console.error("Usage evidence failure: " + (error instanceof Error ? error.message : "invalid")); }
        }
      }
      assert.equal(result.requestStatus, "completed"); assert.equal(result.receiptVerified, true); assert.equal(result.settlementVerified, true);
      const data = result.data as { analysis: { summary: string; sentiment: string; topics: string[] }; model: { runtime: string };
        usageEvidence: { receipt: { params: { requestSha256: string }; result: { usage: unknown; prices: unknown; responseSha256: string } } } };
      assert.equal(data.model.runtime, "otari-api"); assert.ok(data.analysis.summary.length > 0); assert.ok(data.analysis.topics.length > 0);
      assert.equal(h.counters.liveAi, 1);
      liveProof = { model: selected.model, priceTable: selected.price, analysis: data.analysis,
        reportedUsage: data.usageEvidence.receipt.result.usage, reportedCost: data.usageEvidence.receipt.result.prices,
        requestSha256: data.usageEvidence.receipt.params.requestSha256, responseSha256: data.usageEvidence.receipt.result.responseSha256,
        requestId: result.requestId, transactionHash: result.transaction?.hash, localSettlementOnly: true };
    });
  }
  await h.stop();
  const expires = await h.makeSession({ budget: 20_000n, serviceIds: [json.serviceId] });
  const expiresBody = await payload(h, expires, json, input, 0n, "20000");
  const expiresId = fromWireCharge(expiresBody.authorization).requestId;
  await reserveRequest(h.ctx, expires.customer.address.toLowerCase(), json.serviceId, expiresBody);
  await h.ctx.db.aPIRequest.update({ where: { id: expiresId }, data: { requestStatus: "indeterminate", errorCode: "PROVIDER_COMPLETION_UNKNOWN" } });
  await check("expired indeterminate reservations are released only after settlement becomes impossible", async () => {
    let latest = 0n;
    for (const session of h.sessions) {
      const state = await h.ctx.sessions.getSession(session.id);
      if (state.refundAfter > latest) latest = state.refundAfter;
    }
    await h.test.setNextBlockTimestamp({ timestamp: latest + 1n }); await h.test.mine({ blocks: 1 });
    await expireReservations(h.ctx);
    const row = await h.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: expiresId } });
    assert.equal(row.requestStatus, "failed"); assert.equal(row.paymentStatus, "failed"); assert.equal(row.reservationActive, false);
  });
  await check("unused balances refund to customers with exact token conservation", async () => {
    for (const session of h.sessions) await h.send(h.relayer, h.ctx.config.vault,
      encodeFunctionData({ abi: emeterVaultAbi, functionName: "refund", args: [session.id] }));
    const abi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
    const providerBalance = await h.client.readContract({ address: h.ctx.config.token, abi, functionName: "balanceOf", args: [h.providerAccount.address] });
    let customerBalances = 0n;
    for (const session of h.sessions) customerBalances += await h.client.readContract({ address: h.ctx.config.token, abi,
      functionName: "balanceOf", args: [session.customer.address] });
    assert.equal(providerBalance + customerBalances, h.deposited());
    assert.equal(await h.client.readContract({ address: h.ctx.config.token, abi, functionName: "balanceOf", args: [h.ctx.config.vault] }), 0n);
    assert.equal(await h.client.readContract({ address: h.ctx.config.vault, abi: emeterVaultAbi, functionName: "totalLocked" }), 0n);
  });
  const report = { ok: true, startedAt, completedAt: new Date().toISOString(), kind: "anvil-fork", chainId: 196,
    forkBlock: h.forkBlock.toString(), reusedContracts: { vault: h.ctx.config.vault, registry: h.ctx.config.registry,
      token: h.ctx.config.token, adapter: h.ctx.config.adapter }, mainnetBroadcastPerformed: false, contractRedeploymentPerformed: false,
    demoTokenHasMonetaryValue: false, independentAdoption: false, checks, checkCount: checks.length,
    aiExecutions: h.counters, liveAi: liveProof, requests: await h.ctx.db.aPIRequest.count(),
    settledRequests: await h.ctx.db.aPIRequest.count({ where: { paymentStatus: "settled" } }),
    retainedUnknownRequests: await h.ctx.db.aPIRequest.count({ where: { requestStatus: "indeterminate" } }), sourceSha256 };
  const evidence = join(root, "docs/evidence"); await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "gateway-fork-checks.json"), JSON.stringify(report, null, 2) + "\n");
  if (liveProof) await writeFile(join(evidence, "gateway-live-ai-checks.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Gateway proof passed: " + checks.length + " checks, " + h.counters.liveAi + " real upstream AI request(s), no mainnet broadcasts.");
} catch (error) {
  const message = error instanceof Error ? error.message.split("\n")[0]! : "Gateway proof failed";
  console.error("FAIL " + activeCheck + ": " + message.replace(/(?:otk_|sk-)[A-Za-z0-9_-]+/g, "[credential redacted]"));
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (cause instanceof Error) console.error((cause.stack ?? "").split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 5).join("\n"));
  process.exitCode = 1;
} finally { await harness?.close(); }
