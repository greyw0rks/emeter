import { Worker } from "bullmq";
import type { PrivateKeyAccount } from "viem/accounts";
import type { GatewayContext } from "./context.js";
import { createRedisClient } from "./config.js";
import { executeRequest } from "./execution.js";
import { indexChain } from "./indexer.js";
import { settleRequest } from "./settlement.js";
import { fromWireCharge, Tap13EnvelopeSchema } from "@emeter/shared";

export async function expireReservations(ctx: GatewayContext) {
  const head = await ctx.client.getBlock();
  const rows = await ctx.db.aPIRequest.findMany({ where: { reservationActive: true,
    OR: [{ requestStatus: "indeterminate" }, { paymentStatus: "denied" }] } });
  for (const row of rows) {
    const charge = fromWireCharge(row.authorization);
    const session = await ctx.sessions.getSession(charge.sessionId);
    const receipt = await ctx.db.usageReceipt.findUnique({ where: { requestId: row.id } });
    const receiptTs = receipt ? BigInt(Tap13EnvelopeSchema.parse(receipt.envelope).ts) : undefined;
    if (session.signerRevoked || session.status === 3 || head.timestamp >= session.refundAfter
      || head.timestamp > charge.validUntil + session.settlementWindow
      || receiptTs !== undefined && head.timestamp > receiptTs + session.settlementWindow) {
      await ctx.db.aPIRequest.updateMany({ where: { id: row.id, reservationActive: true,
        paymentStatus: { not: "settled" } }, data: {
        requestStatus: row.requestStatus === "indeterminate" ? "failed" : row.requestStatus,
        paymentStatus: "failed", chargeAuthorized: false, reservationActive: false,
        errorCode: "SETTLEMENT_AUTHORIZATION_EXPIRED"
      } });
    }
  }
}

export async function startWorkers(ctx: GatewayContext, account: PrivateKeyAccount) {
  await indexChain(ctx);
  const connection = createRedisClient(ctx.config.redisUrl, true);
  const options = { connection, prefix: ctx.config.queuePrefix };
  const execution = new Worker("execution", async job => executeRequest(ctx, job.data.requestId), { ...options, concurrency: 2 });
  const settlement = new Worker("settlement", async job => settleRequest(ctx, job.data.requestId, account), { ...options, concurrency: 1 });
  execution.on("error", () => { /* Queue retries retain the durable request. */ });
  settlement.on("error", () => { /* Queue retries retain the signed transaction. */ });
  try { await Promise.all([execution.waitUntilReady(), settlement.waitUntilReady()]); }
  catch (error) { connection.disconnect(); await execution.close(true); await settlement.close(true); throw error; }
  await ctx.db.workerHeartbeat.upsert({ where: { id: ctx.config.queuePrefix },
    create: { id: ctx.config.queuePrefix }, update: { updatedAt: new Date() } });
  execution.on("failed", (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void ctx.db.aPIRequest.updateMany({ where: { id: job.data.requestId, requestStatus: { in: ["authorized", "processing"] } },
      data: { requestStatus: "indeterminate",
        errorCode: ["PROVIDER_RATE_LIMITED", "AI_USAGE_EVIDENCE_INVALID"].includes(error.message) ? error.message : "PROVIDER_COMPLETION_UNKNOWN",
        reservationActive: true } }).catch(() => { /* The durable job remains failed for recovery. */ });
  });
  let indexing = false;
  const tick = async () => {
    if (indexing) return;
    indexing = true;
    try {
      await indexChain(ctx);
      await expireReservations(ctx);
      const waiting = await ctx.db.aPIRequest.findMany({ where: { requestStatus: { in: ["authorized", "processing"] } } });
      for (const row of waiting) {
        const job = await ctx.executionQueue.getJob(row.id);
        if (!job) await ctx.executionQueue.add("execute", { requestId: row.id }, { jobId: row.id });
        else {
          const state = await job.getState();
          if (state === "completed") { await job.remove(); await ctx.executionQueue.add("execute", { requestId: row.id }, { jobId: row.id }); }
          else if (state === "failed") await ctx.db.aPIRequest.updateMany({ where: { id: row.id,
            requestStatus: { in: ["authorized", "processing"] } }, data: {
              requestStatus: "indeterminate", errorCode: "PROVIDER_COMPLETION_UNKNOWN", reservationActive: true
            } });
        }
      }
      const pending = await ctx.db.aPIRequest.findMany({ where: { requestStatus: "completed", paymentStatus: { in: ["unsubmitted", "pending"] } } });
      for (const row of pending) {
        const job = await ctx.settlementQueue.getJob(row.id);
        if (!job) await ctx.settlementQueue.add("settle", { requestId: row.id }, { jobId: row.id });
        else if (await job.getState() === "failed") await job.retry();
      }
      await ctx.db.workerHeartbeat.update({ where: { id: ctx.config.queuePrefix }, data: { updatedAt: new Date() } });
    } catch { /* Readiness fails closed when the indexer's state is unavailable. */ }
    finally { indexing = false; }
  };
  let tickDone = Promise.resolve();
  const timer = setInterval(() => { if (!indexing) tickDone = tick(); }, 2000);
  return { close: async () => { clearInterval(timer); await tickDone; await execution.close(); await settlement.close();
    connection.disconnect(); await ctx.db.workerHeartbeat.deleteMany({ where: { id: ctx.config.queuePrefix } }); } };
}
