import { belongsToPayment } from "./payment-scope.js";
import type { Hex } from "viem";
import type { Prisma } from "@emeter/database";
import { fromWireCharge, jsonSafe, verifyAiEvidence, verifyTap13Response } from "@emeter/shared";
import type { JsonValue, ServiceCall } from "@emeter/shared";
import type { GatewayContext } from "./context.js";
import { callProvider } from "./services.js";

export async function executeRequest(ctx: GatewayContext, requestId: string) {
  if ((await ctx.db.indexerCursor.findUnique({ where: { id: ctx.config.vault.toLowerCase() } }))?.state === "reorg_detected")
    throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  const row = await ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (!belongsToPayment(ctx, row)) throw new Error("REQUEST_PAYMENT_DEPLOYMENT_MISMATCH");
  if (row.requestStatus === "completed") {
    if (row.paymentStatus !== "settled") await ctx.settlementQueue.add("settle", { requestId }, { jobId: requestId });
    return;
  }
  if (row.requestStatus === "failed" || row.requestStatus === "indeterminate") return;
  const charge = fromWireCharge(row.authorization);
  const [session, quote, head, terms] = await Promise.all([
    ctx.sessions.getSession(charge.sessionId), ctx.sessions.getQuote(charge.serviceId, charge.priceVersion),
    ctx.client.getBlock(), ctx.db.priceVersion.findUniqueOrThrow({ where: { serviceId_version: { serviceId: row.serviceId, version: row.priceVersion } } })
  ]);
  if (session.status !== 1 || session.signerRevoked || head.timestamp >= session.executionDeadline
    || head.timestamp + BigInt(Math.ceil(ctx.config.executionTimeoutMs / 1000)) >= charge.validUntil
    || !quote.active || quote.price.toString() !== row.amount.toFixed(0)) {
    await ctx.db.aPIRequest.update({ where: { id: requestId }, data: {
      requestStatus: "failed", reservationActive: false, errorCode: "EXECUTION_AUTHORIZATION_UNAVAILABLE"
    } });
    return;
  }
  await ctx.db.aPIRequest.update({ where: { id: requestId }, data: { requestStatus: "processing" } });
  const call = row.wireRequest as unknown as ServiceCall;
  let response: Awaited<ReturnType<typeof callProvider>>;
  try { response = await callProvider(ctx, terms.endpoint, call); }
  catch {
    // The provider persists request-id results. A retry asks for the same
    // result, never allocates another customer nonce or another charge.
    throw new Error("PROVIDER_TRANSPORT_UNAVAILABLE");
  }
  const verified = await verifyTap13Response({ ...response, call, container: quote.container, signer: quote.signer,
    now: Number((await ctx.client.getBlock()).timestamp) });
  if (verified.outcome === "rate_limited") throw new Error("PROVIDER_RATE_LIMITED");
  if ((verified.outcome !== "accepted_result" && verified.outcome !== "accepted_error") || !verified.envelope || !verified.receipt) {
    if (verified.outcome === "own_request_malformed") {
      await ctx.db.aPIRequest.update({ where: { id: requestId }, data: {
        requestStatus: "failed", errorCode: "PROVIDER_REQUEST_MALFORMED", reservationActive: false
      } });
      return;
    }
    // Reread the pinned immutable price version before any retry (TAP-13 §8).
    // A different reported signer cannot rewrite the customer's signed price.
    await ctx.sessions.getQuote(charge.serviceId, charge.priceVersion);
    throw new Error("PROVIDER_RESPONSE_" + verified.outcome.toUpperCase());
  }
  if (!verified.envelope.ok && verified.envelope.error?.data?.completion === "unknown") {
    await ctx.db.aPIRequest.update({ where: { id: requestId }, data: {
      requestStatus: "indeterminate", errorCode: "PROVIDER_COMPLETION_UNKNOWN", reservationActive: true
    } });
    return;
  }
  const result = verified.envelope.ok ? verified.envelope.result : verified.envelope.error;
  const usage = typeof result === "object" && result !== null && !Array.isArray(result) ? (result as Record<string, unknown>).usageEvidence : undefined;
  const aiReceipt = typeof usage === "object" && usage !== null ? (usage as Record<string, unknown>).receipt : undefined;
  if (verified.envelope.ok && call.method === "text_analyze") {
    try { await verifyAiEvidence(usage, { container: quote.container, signer: quote.signer,
      text: (call.params.input as Record<string, JsonValue>).text as string,
      analysis: (result as Record<string, JsonValue>).analysis }); }
    catch { throw new Error("AI_USAGE_EVIDENCE_INVALID"); }
  }
  await ctx.db.$transaction(async tx => {
    await tx.usageReceipt.upsert({ where: { requestId }, create: {
      requestId, envelope: jsonSafe(verified.envelope) as Prisma.InputJsonValue, digest: verified.digest!,
      bodyHash: verified.receipt!.bodyHash, signer: quote.signer, providerVerified: true,
      ...(usage ? { reportedUsage: jsonSafe(usage) as Prisma.InputJsonValue } : {}),
      ...(aiReceipt ? { aiReceipt: jsonSafe(aiReceipt) as Prisma.InputJsonValue } : {})
    }, update: {} });
    await tx.aPIRequest.update({ where: { id: requestId }, data: {
      requestStatus: verified.envelope!.ok ? "completed" : "failed",
      ...(result === null ? {} : { result: jsonSafe(result) as Prisma.InputJsonValue }),
      errorCode: verified.envelope!.ok ? null : verified.envelope!.error!.code,
      reservationActive: verified.envelope!.ok
    } });
  });
  if (verified.envelope.ok) await ctx.settlementQueue.add("settle", { requestId }, { jobId: requestId });
}
