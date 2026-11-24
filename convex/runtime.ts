"use node";

import { randomUUID } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { jsonSafe } from "@emeter/shared";
import { buildGateway } from "../apps/gateway/src/app";
import { buildProvider, builtInServices } from "../apps/gateway/src/providers";
import { boundedAnalyzer } from "./lib/analyzer";
import { executeRequest } from "../apps/gateway/src/execution";
import { settleRequest } from "../apps/gateway/src/settlement";
import { indexChain, rebuildIndexer as rebuild } from "../apps/gateway/src/indexer";
import { expireReservations } from "../apps/gateway/src/expiry";
import { createRuntimeContext, runtimeConfig, signer } from "./lib/runtime";
import { errorCode } from "./lib/database";
import type { GatewayContext } from "../apps/gateway/src/context";
import proof from "../docs/evidence/mainnet-verification.json";

import { paymentScope } from "../apps/gateway/src/payment-scope";

async function canonical(context: GatewayContext) {
  const cursor = await context.db.indexerCursor.findUnique({ where: { id: context.config.vault.toLowerCase() } });
  if (!cursor || cursor.state !== "ready") throw new Error("CHAIN_INDEXER_NOT_READY");
  const block = await context.client.getBlock({ blockNumber: cursor.blockNumber });
  if (block.hash !== cursor.blockHash) {
    await context.db.indexerCursor.update({ where: { id: cursor.id }, data: { state: "reorg_detected" } });
    throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  }
}

export const handle = internalAction({
  args: { method: v.string(), path: v.string(), body: v.optional(v.string()), origin: v.optional(v.string()),
    credentialHash: v.optional(v.string()), issuedCredentialHash: v.optional(v.string()),
    dispatchTimestamp: v.optional(v.string()), dispatchSignature: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ status: number; body: string; headers: Record<string,string> }> => {
    const context = await createRuntimeContext(ctx);
    if (context.config.executionEnabled && args.path.startsWith("/api/")) {
      const cursor = await context.db.indexerCursor.findUnique({ where: { id: context.config.vault.toLowerCase() } });
      const paidPost = args.method === "POST" && (args.path.startsWith("/api/execute/") || args.path === "/api/settlements");
      if (paidPost || !cursor || cursor.updatedAt.getTime() < Date.now() - 5000) await ctx.runAction(internal.runtime.maintenance, {});
      if (paidPost) await canonical(context);
    }
    if (args.credentialHash) context.credentialHash = args.credentialHash;
    if (args.issuedCredentialHash) context.issuedCredentialHash = args.issuedCredentialHash;
    const provider = args.path.startsWith("/services/") || args.path === "/.well-known/emeter.json" || args.path === "/provider-health";
    const method = args.path.split("?")[0]!.split("/").pop();
    if (args.path === "/.well-known/emeter.json" && args.method === "GET")
      return { status: 200, body: JSON.stringify({ services: Object.values(builtInServices(context)) }), headers: { "content-type": "application/json" } };
    if (args.path === "/provider-health" && args.method === "GET")
      return { status: 200, body: JSON.stringify({ configured: Boolean(process.env.OTARI_API_KEY && process.env.EMETER_PROVIDER_PRIVATE_KEY), runtime: "otari-api" }), headers: { "content-type": "application/json" } };
    if (provider && args.method === "POST" && !["emeter_probe", "receipt"].includes(method ?? "") && !context.config.executionEnabled)
      return { status: 503, body: JSON.stringify({ error: "PAID_EXECUTION_NOT_READY" }), headers: { "content-type": "application/json" } };
    const app = provider
      ? buildProvider(context, signer("provider", context.config.providerSigner),
        { model: process.env.EMETER_AI_MODEL ?? "mistralai/mistral-small-3.2-24b", runtime: "otari-api", analyze: async text => {
          const analyzer = await boundedAnalyzer(ctx, context.config.container, signer("provider", context.config.providerSigner).signMessage,
            args.body ? String(JSON.parse(args.body).id ?? "") : "");
          return analyzer.analyze(text);
        } })
      : buildGateway({ context, recordedMainnetProofVerified: proof.kind === "mainnet-read-only-verification" && proof.independentRpcAgreement });
    try {
      const response = await app.inject({ method: args.method as "GET" | "POST" | "DELETE" | "OPTIONS",
        url: args.path === "/provider-health" ? "/health" : args.path,
        ...(args.body === undefined ? {} : { payload: args.body }),
        headers: { ...(args.body === undefined ? {} : { "content-type": "application/json" }),
          ...(args.origin ? { origin: args.origin } : {}), ...(args.dispatchTimestamp ? { "x-emeter-timestamp": args.dispatchTimestamp } : {}),
          ...(args.dispatchSignature ? { "x-emeter-dispatch": args.dispatchSignature } : {}) } });
      return { status: response.statusCode, body: response.body,
        headers: { "content-type": String(response.headers["content-type"] ?? "application/json") } };
    } finally { await app.close(); }
  }
});

export const runJob = internalAction({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const config = runtimeConfig();
    if (!config.executionEnabled || !args.key.startsWith(config.queuePrefix + ":")) return;
    const owner = randomUUID(), job = await ctx.runMutation(internal.queue.claim, { key: args.key, owner });
    if (!job) return;
    try {
      const context = await createRuntimeContext(ctx, { key: args.key, owner });
      if (!context.config.executionEnabled) throw new Error("RUNTIME_PAUSED");
      await canonical(context);
      if (job.queue === "execution") await executeRequest(context, job.requestId);
      else await settleRequest(context, job.requestId, signer("relayer", context.config.deployer));
      await ctx.runMutation(internal.queue.finish, { key: args.key, owner });
      await ctx.scheduler.runAfter(5000, internal.runtime.maintenance, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["PROVIDER_TRANSPORT_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "AI_USAGE_EVIDENCE_INVALID", "RELAYER_NEEDS_GAS",
        "RELAYER_GAS_BUDGET_EXCEEDED", "RELAYER_TRANSACTION_PENDING", "CHAIN_REORG_RECONCILIATION_REQUIRED", "RUNTIME_PAUSED"];
      await ctx.runMutation(internal.queue.finish, { key: args.key, owner, errorCode: errorCode(error) ?? (known.includes(message) ? message : "DURABLE_JOB_FAILED") });
    }
  }
});

async function repairGateway(context: GatewayContext) {
  const waiting = await context.db.aPIRequest.findMany({ where: { ...paymentScope(context), requestStatus: { in: ["authorized", "processing"] } } });
  for (const row of waiting) {
    const job = await context.executionQueue.getJob(row.id);
    if (!job) await context.executionQueue.add("execute", { requestId: row.id }, { jobId: row.id });
    else if (await job.getState() === "completed") { await job.remove(); await context.executionQueue.add("execute", { requestId: row.id }, { jobId: row.id }); }
  }
  const pending = await context.db.aPIRequest.findMany({ where: { ...paymentScope(context), requestStatus: "completed", paymentStatus: { in: ["unsubmitted", "pending"] } } });
  for (const row of pending) {
    const job = await context.settlementQueue.getJob(row.id);
    if (!job) await context.settlementQueue.add("settle", { requestId: row.id }, { jobId: row.id });
    else if (await job.getState() === "failed") await job.retry();
  }
}

export const maintenance = internalAction({
  args: {}, handler: async (ctx): Promise<void> => {
    if ((await ctx.runQuery(internal.store.control, {})).paused) return;
    const owner = randomUUID();
    try { await ctx.runMutation(internal.store.acquire, { resource: "maintenance", owner, ttl: 30_000 }); }
    catch { return; }
    try {
      const context = await createRuntimeContext(ctx);
      if ((await ctx.runQuery(internal.store.control, {})).paused) return;
      await indexChain(context);
      await expireReservations(context);
      await ctx.runMutation(internal.queue.repair, { dispatch: context.config.executionEnabled ?? false, prefix: context.config.queuePrefix });
      if (context.config.executionEnabled) await repairGateway(context);
      await context.db.workerHeartbeat.upsert({ where: { id: context.config.queuePrefix }, create: { id: context.config.queuePrefix }, update: { updatedAt: new Date() } });
      if (context.config.executionEnabled && await context.db.aPIRequest.count({ where: { ...paymentScope(context), OR: [
        { requestStatus: { in: ["authorized", "processing"] } }, { requestStatus: "completed", paymentStatus: { in: ["unsubmitted", "pending"] } }
      ] } }) > 0) await ctx.scheduler.runAfter(5000, internal.runtime.maintenance, {});
    } catch { /* A stale cursor or heartbeat keeps paid execution unavailable. */ }
    finally { await ctx.runMutation(internal.store.release, { resource: "maintenance", owner }); }
  }
});

export const rebuildIndexer = internalAction({
  args: {}, handler: async (ctx): Promise<{ rebuilt: boolean }> => {
    await ctx.runMutation(internal.store.pause, { paused: true });
    const counts = await Promise.all([ctx.runQuery(internal.queue.counts, { queue: "execution" }), ctx.runQuery(internal.queue.counts, { queue: "settlement" })]);
    if (counts.some(value => (value.active ?? 0) > 0)) throw new Error("WAIT_FOR_ACTIVE_JOBS_BEFORE_REBUILD");
    const context = await createRuntimeContext(ctx);
    delete context.config.indexerMaxBatches;
    await rebuild(context);
    await ctx.runMutation(internal.store.pause, { paused: false });
    return { rebuilt: true };
  }
});

/** Operator diagnostics expose public identities and bounded error codes only. */
export const diagnostics = internalAction({
  args: {}, handler: async (ctx): Promise<any> => {
    const context = await createRuntimeContext(ctx);
    const indexerKey = context.config.vault.toLowerCase();
    let indexing: any;
    try { indexing = { ok: true, result: await indexChain(context) }; }
    catch (error) {
      const value = error as { name?: string; shortMessage?: string; message?: string };
      indexing = { ok: false, code: errorCode(error) ?? "INDEXER_FAILED", name: value.name ?? "Error",
        message: String(value.shortMessage ?? value.message ?? "Indexing unavailable").slice(0,300) };
    }
    return jsonSafe({ executionEnabled: context.config.executionEnabled, indexing,
      cursor: await context.db.indexerCursor.findUnique({ where: { id: indexerKey } }),
      heartbeat: await context.db.workerHeartbeat.findUnique({ where: { id: context.config.queuePrefix } }),
      queue: await context.executionQueue.getJobCounts() });
  }
});
