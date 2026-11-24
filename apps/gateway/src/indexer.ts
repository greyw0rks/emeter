import { paymentScope } from "./payment-scope.js";
import { decodeEventLog } from "viem";
import type { Hex } from "viem";
import type { Prisma } from "@emeter/database";
import { emeterRegistryAbi, emeterVaultAbi, jsonSafe } from "@emeter/shared";
import type { GatewayContext } from "./context.js";

export async function indexChain(ctx: GatewayContext) {
  const key = ctx.config.vault.toLowerCase();
  const head = await ctx.client.getBlockNumber({ cacheTime: 0 });
  const confirmed = head > BigInt(ctx.config.confirmations) ? head - BigInt(ctx.config.confirmations) : 0n;
  let cursor = await ctx.db.indexerCursor.findUnique({ where: { id: key } });
  if (!cursor) {
    const block = await ctx.client.getBlock({ blockNumber: ctx.config.deploymentBlock - 1n });
    cursor = await ctx.db.indexerCursor.create({ data: { id: key, blockNumber: block.number, blockHash: block.hash, state: "rebuilding" } });
  }
  if (cursor.blockNumber > head) {
    await ctx.db.indexerCursor.update({ where: { id: key }, data: { state: "reorg_detected" } });
    throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  }
  const predecessor = await ctx.client.getBlock({ blockNumber: cursor.blockNumber });
  if (predecessor.hash !== cursor.blockHash) {
    await ctx.db.indexerCursor.update({ where: { id: key }, data: { state: "reorg_detected" } });
    throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  }
  if (cursor.state === "reorg_detected") throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  let batches = 0;
  const batchSize = BigInt(ctx.config.indexerBatchBlocks ?? 100);
  while (cursor.blockNumber < confirmed && batches < (ctx.config.indexerMaxBatches ?? Infinity)) {
    const end = cursor.blockNumber + batchSize < confirmed ? cursor.blockNumber + batchSize : confirmed;
    const logs = await ctx.client.getLogs({ address: [ctx.config.vault, ctx.config.registry],
      fromBlock: cursor.blockNumber + 1n, toBlock: end });
    const finalBlock = await ctx.client.getBlock({ blockNumber: end });
    const decoded = logs.map(log => {
      try { return { log, event: decodeEventLog({ abi: [...emeterVaultAbi, ...emeterRegistryAbi], data: log.data, topics: log.topics }) }; }
      catch { return null; }
    }).filter(item => item !== null);
    const states = new Map<string, Awaited<ReturnType<typeof ctx.sessions.getSession>>>();
    for (const item of decoded) {
      const args = item.event.args as Record<string, unknown>;
      if (typeof args.sessionId === "string" && item.log.blockNumber !== null) {
        const session = await ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi,
          functionName: "getSession", args: [args.sessionId as Hex], blockNumber: item.log.blockNumber });
        states.set(args.sessionId + ":" + item.log.blockNumber, session);
      }
    }
    const previous = cursor.blockNumber;
    await ctx.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "indexer:" + key);
      const current = await tx.indexerCursor.findUniqueOrThrow({ where: { id: key } });
      if (current.blockNumber !== previous) throw new Error("INDEXER_CURSOR_CHANGED");
      for (const item of decoded) {
        const { log, event } = item;
        if (log.transactionHash === null || log.blockNumber === null || log.blockHash === null || log.logIndex === null) continue;
        const args = event.args as Record<string, unknown>;
        if (typeof args.sessionId === "string")
          await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", args.sessionId);
        await tx.chainEvent.upsert({ where: { chainId_transactionHash_logIndex: {
          chainId: 196, transactionHash: log.transactionHash, logIndex: log.logIndex } },
          create: { chainId: 196, transactionHash: log.transactionHash, logIndex: log.logIndex,
            blockNumber: log.blockNumber, blockHash: log.blockHash, contract: log.address.toLowerCase(),
            eventName: event.eventName, arguments: jsonSafe(args) as Prisma.InputJsonValue }, update: {} });
        if (typeof args.sessionId === "string") {
          const session = states.get(args.sessionId + ":" + log.blockNumber);
          if (session) {
            const data = { ...paymentScope(ctx), customer: session.customer.toLowerCase(), signer: session.signer.toLowerCase(),
              budget: session.budget.toString(), softLimit: session.softLimit.toString(), maxCharge: session.maxCharge.toString(),
              expiresAt: session.expiresAt, refundAfter: session.refundAfter, status: session.status, indexedBlock: log.blockNumber };
            await tx.spendingSession.upsert({ where: { id: args.sessionId }, create: { id: args.sessionId, ...data }, update: data });
          }
        }
        if (event.eventName === "ChargeSettled" && typeof args.requestId === "string") {
          const row = await tx.aPIRequest.findUnique({ where: { id: args.requestId } });
          if (!row) continue; // Historical protocol proofs remain chain events.
          if (row.sessionId !== args.sessionId || row.serviceId !== args.serviceId
            || row.priceVersion !== args.priceVersion || row.amount.toFixed(0) !== String(args.amount))
            throw new Error("SETTLEMENT_EVENT_BINDING_FAILED");
          const savedReceipt = await tx.usageReceipt.findUnique({ where: { requestId: row.id } });
          if (!savedReceipt || !savedReceipt.providerVerified || savedReceipt.digest.toLowerCase() !== String(args.receiptDigest).toLowerCase())
            throw new Error("SETTLEMENT_RECEIPT_BINDING_FAILED");
          const data = { transactionHash: log.transactionHash, amount: String(args.amount), blockNumber: log.blockNumber,
            blockHash: log.blockHash, policyInputs: Number(args.policyInputs), confirmationStatus: "confirmed" };
          await tx.settlement.upsert({ where: { requestId: row.id }, create: { requestId: row.id, ...data }, update: data });
          await tx.aPIRequest.update({ where: { id: row.id }, data: {
            paymentStatus: "settled", chargeAuthorized: true, policyInputs: Number(args.policyInputs),
            reservationActive: false, errorCode: null
          } });
        }
      }
      await tx.indexerCursor.update({ where: { id: key }, data: {
        blockNumber: end, blockHash: finalBlock.hash, state: end === confirmed ? "ready" : "rebuilding"
      } });
    }, { timeout: 20_000 });
    cursor = await ctx.db.indexerCursor.findUniqueOrThrow({ where: { id: key } });
    batches++;
  }
  if (cursor.blockNumber >= confirmed)
    await ctx.db.indexerCursor.update({ where: { id: key }, data: { state: "ready", updatedAt: new Date() } });
  return { blockNumber: cursor.blockNumber.toString(), confirmedHead: confirmed.toString() };
}

/** Rebuild only indexed projections. Signed customer/provider evidence stays
 * intact; orphaned transaction attempts retain their original raw transaction.
 */
export async function rebuildIndexer(ctx: GatewayContext) {
  const initial = await ctx.client.getBlock({ blockNumber: ctx.config.deploymentBlock - 1n });
  await ctx.db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "indexer:" + ctx.config.vault.toLowerCase());
    await tx.indexerCursor.upsert({ where: { id: ctx.config.vault.toLowerCase() },
      create: { id: ctx.config.vault.toLowerCase(), blockNumber: initial.number, blockHash: initial.hash, state: "rebuilding" },
      update: { blockNumber: initial.number, blockHash: initial.hash, state: "rebuilding" } });
    await tx.chainEvent.deleteMany({ where: { chainId: 196, contract: ctx.config.vault.toLowerCase() } });
    await tx.spendingSession.deleteMany({ where: paymentScope(ctx) });
    const current = await tx.aPIRequest.findMany({ where: paymentScope(ctx), select: { id: true } });
    await tx.settlement.updateMany({ where: { requestId: { in: current.map(row => row.id) } }, data: { confirmationStatus: "pending" } });
    await tx.aPIRequest.updateMany({ where: { ...paymentScope(ctx), paymentStatus: "settled" }, data: { paymentStatus: "pending", reservationActive: true } });
  });
  await indexChain(ctx);
  const pending = await ctx.db.aPIRequest.findMany({ where: { ...paymentScope(ctx), paymentStatus: "pending", requestStatus: "completed" } });
  for (const row of pending) {
    await ctx.db.settlementAttempt.updateMany({ where: { requestId: row.id, status: "mined" }, data: { status: "prepared" } });
    await ctx.settlementQueue.add("settle", { requestId: row.id }, { jobId: row.id + "-reconcile" });
  }
}
