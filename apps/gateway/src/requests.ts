import type { FastifyInstance } from "fastify";
import type { Address, Hex } from "viem";
import { hashTypedData, keccak256, toHex } from "viem";
import { z } from "zod";
import { canonicalJson, ClientIdSchema, HashSchema, SignatureSchema, WireChargeSchema,
  chargeSigningPayload, fromWireCharge, jsonSafe, MethodSchema, requestHash, emeterVaultAbi, WalletSignatureSchema,
  overrideSigningPayload, sessionChargeDigest } from "@emeter/shared";
import type { JsonValue, ServiceCall } from "@emeter/shared";
import type { Prisma } from "@emeter/database";
import { authenticate, HttpError } from "./auth.js";
import type { GatewayContext } from "./context.js";
import { readiness } from "./readiness.js";

export const WireOverrideSchema = z.object({
  sessionId: HashSchema, chargeDigest: HashSchema,
  maxTotalSpend: z.string().regex(/^[1-9][0-9]*$/), validUntil: z.string().regex(/^[0-9]+$/),
  signature: WalletSignatureSchema
}).strict();
const ExecuteSchema = z.object({
  call: z.object({ id: ClientIdSchema, method: MethodSchema, params: z.record(z.string(), z.unknown()) }).strict(),
  authorization: WireChargeSchema, signature: WalletSignatureSchema, customerOverride: WireOverrideSchema.optional()
}).strict();
export function fromWireOverride(input: z.infer<typeof WireOverrideSchema>) {
  return { sessionId: input.sessionId, chargeDigest: input.chargeDigest, maxTotalSpend: BigInt(input.maxTotalSpend), validUntil: BigInt(input.validUntil) };
}

export async function reserveRequest(ctx: GatewayContext, wallet: string, serviceId: Hex, payload: unknown) {
  const input = ExecuteSchema.parse(payload);
  const charge = fromWireCharge(input.authorization);
  const call = input.call as ServiceCall;
  if (charge.serviceId !== serviceId || charge.requestId !== keccak256(toHex(call.id))
    || charge.requestHash !== requestHash(call) || call.params.sessionId !== charge.sessionId
    || call.params.serviceId !== charge.serviceId || call.params.priceVersion !== charge.priceVersion
    || !("input" in call.params) || Object.keys(call.params).sort().join(",") !== "input,priceVersion,serviceId,sessionId")
    throw new HttpError(400, "REQUEST_AUTHORIZATION_BINDING_FAILED");
  const payloadHash = keccak256(toHex(canonicalJson(input)));
  const existing = await ctx.db.aPIRequest.findUnique({ where: { id: charge.requestId } });
  if (existing) {
    if (existing.payloadHash !== payloadHash || existing.customer !== wallet) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
    return existing;
  }
  const [session, quote, head, service, terms, usedNonce, allowedService] = await Promise.all([
    ctx.sessions.getSession(charge.sessionId), ctx.sessions.getQuote(serviceId, charge.priceVersion), ctx.client.getBlock(),
    ctx.db.service.findUnique({ where: { id: serviceId } }),
    ctx.db.priceVersion.findUnique({ where: { serviceId_version: { serviceId, version: charge.priceVersion } } }),
    ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "consumedChargeNonces", args: [charge.sessionId, charge.nonce] }),
    ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "sessionServiceAllowed", args: [charge.sessionId, serviceId] })
  ]);
  if (session.customer.toLowerCase() !== wallet) throw new HttpError(403, "NOT_SESSION_CUSTOMER");
  if (session.status !== 1 || session.signerRevoked || head.timestamp >= session.executionDeadline)
    throw new HttpError(409, "SESSION_NOT_ACCEPTING_REQUESTS");
  if (!service?.verifiedAt || !service.active || !terms || !terms.active || !quote.active || !allowedService
    || terms.metadataHash !== quote.metadataHash.toLowerCase() || call.method !== terms.method)
    throw new HttpError(409, "SERVICE_NOT_VERIFIED_OR_AUTHORIZED");
  if (usedNonce) throw new HttpError(409, "CHARGE_NONCE_CONSUMED");
  if (charge.issuedAt < session.createdAt || charge.issuedAt > head.timestamp
    || charge.validUntil < head.timestamp || charge.validUntil > session.expiresAt)
    throw new HttpError(400, "AUTHORIZATION_EXPIRED");
  if (quote.price > charge.maxAmount || charge.maxAmount > session.maxCharge || quote.price > session.maxCharge)
    throw new HttpError(402, "SIGNED_CHARGE_LIMIT_EXCEEDED");
  if (!await ctx.client.verifyTypedData({ ...chargeSigningPayload(ctx.config.vault, charge), address: session.signer, signature: input.signature }))
    throw new HttpError(401, "INVALID_SESSION_SIGNATURE");
  let overrideCap: bigint | undefined;
  if (input.customerOverride) {
    const grant = fromWireOverride(input.customerOverride);
    if (grant.sessionId !== charge.sessionId || grant.chargeDigest !== sessionChargeDigest(ctx.config.vault, charge)
      || grant.validUntil < head.timestamp || grant.validUntil > session.refundAfter || grant.maxTotalSpend > session.budget
      || !await ctx.client.verifyTypedData({ ...overrideSigningPayload(ctx.config.vault, grant), address: session.customer, signature: input.customerOverride.signature }))
      throw new HttpError(401, "INVALID_CUSTOMER_OVERRIDE");
    overrideCap = grant.maxTotalSpend;
  }
  return ctx.db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", charge.sessionId);
    const duplicate = await tx.aPIRequest.findUnique({ where: { id: charge.requestId } });
    if (duplicate) {
      if (duplicate.payloadHash !== payloadHash || duplicate.customer !== wallet) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      return duplicate;
    }
    if (await tx.aPIRequest.findUnique({ where: { sessionId_nonce: { sessionId: charge.sessionId, nonce: charge.nonce.toString() } } }))
      throw new HttpError(409, "REQUEST_NONCE_RESERVED");
    // Chain reads must happen after taking the session lock. An indexer may
    // otherwise release an old reservation while this request uses stale spend.
    const [currentSession, currentQuote, currentHead, nonceConsumed] = await Promise.all([
      ctx.sessions.getSession(charge.sessionId), ctx.sessions.getQuote(serviceId, charge.priceVersion),
      ctx.client.getBlock(),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi,
        functionName: "consumedChargeNonces", args: [charge.sessionId, charge.nonce] })
    ]);
    if (currentSession.status !== 1 || currentSession.signerRevoked || currentHead.timestamp >= currentSession.executionDeadline)
      throw new HttpError(409, "SESSION_NOT_ACCEPTING_REQUESTS");
    if (nonceConsumed) throw new HttpError(409, "CHARGE_NONCE_CONSUMED");
    if (!currentQuote.active || currentQuote.price !== quote.price)
      throw new HttpError(409, "SERVICE_NOT_VERIFIED_OR_AUTHORIZED");
    if (charge.validUntil < currentHead.timestamp || input.customerOverride && BigInt(input.customerOverride.validUntil) < currentHead.timestamp)
      throw new HttpError(400, "AUTHORIZATION_EXPIRED");
    const active = await tx.aPIRequest.aggregate({ where: { sessionId: charge.sessionId, reservationActive: true }, _sum: { amount: true } });
    const reserved = BigInt(active._sum.amount?.toFixed(0) ?? "0");
    if (reserved + quote.price > currentSession.balance) throw new HttpError(402, "SESSION_BUDGET_RESERVED");
    if (currentSession.spent + reserved + quote.price > currentSession.softLimit
      && (overrideCap === undefined || overrideCap < currentSession.spent + reserved + quote.price))
      throw new HttpError(402, "CUSTOMER_SOFT_LIMIT_OVERRIDE_REQUIRED");
    return tx.aPIRequest.create({ data: {
      id: charge.requestId, clientId: call.id, sessionId: charge.sessionId, customer: wallet,
      serviceId, priceVersion: charge.priceVersion, nonce: charge.nonce.toString(),
      requestHash: charge.requestHash, payloadHash, wireRequest: jsonSafe(call) as Prisma.InputJsonValue,
      authorization: jsonSafe(input.authorization) as Prisma.InputJsonValue, chargeSignature: input.signature,
      ...(input.customerOverride ? { customerOverride: jsonSafe(input.customerOverride) as Prisma.InputJsonValue } : {}),
      amount: quote.price.toString()
    } });
  }, { timeout: 10_000 });
}

export async function requestRecord(ctx: GatewayContext, id: Hex, wallet: string, scopeServiceId?: string, scopeSessionId?: string) {
  const row = await ctx.db.aPIRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "UNKNOWN_REQUEST");
  const service = await ctx.db.service.findUnique({ where: { id: row.serviceId } });
  if (row.customer !== wallet && !(service?.provider === wallet && (!scopeServiceId || scopeServiceId === row.serviceId)))
    throw new HttpError(404, "UNKNOWN_REQUEST");
  if (scopeServiceId && scopeServiceId !== row.serviceId) throw new HttpError(404, "UNKNOWN_REQUEST");
  if (scopeSessionId && scopeSessionId !== row.sessionId) throw new HttpError(404, "UNKNOWN_REQUEST");
  const [receipt, settlement, attempt, terms] = await Promise.all([
    ctx.db.usageReceipt.findUnique({ where: { requestId: id } }),
    ctx.db.settlement.findUnique({ where: { requestId: id } }),
    ctx.db.settlementAttempt.findFirst({ where: { requestId: id }, orderBy: { createdAt: "desc" } }),
    ctx.db.priceVersion.findUnique({ where: { serviceId_version: { serviceId: row.serviceId, version: row.priceVersion } } })
  ]);
  if (!terms) throw new HttpError(503, "REQUEST_SERVICE_TERMS_UNAVAILABLE");
  return { requestId: row.id, clientId: row.clientId, sessionId: row.sessionId, serviceId: row.serviceId,
    priceVersion: row.priceVersion, requestHash: row.requestHash, call: row.wireRequest,
    serviceManifest: terms.manifest,
    authorization: row.authorization, chargeSignature: row.chargeSignature,
    requestStatus: row.requestStatus, paymentStatus: row.paymentStatus,
    chargeAuthorized: row.chargeAuthorized, priceBaseUnits: row.amount.toFixed(0),
    policyInputs: row.policyInputs,
    data: row.result, error: row.errorCode, receipt,
    transaction: settlement ? { hash: settlement.transactionHash, blockNumber: settlement.blockNumber.toString(),
      policyInputs: settlement.policyInputs, confirmationStatus: settlement.confirmationStatus }
      : attempt?.transactionHash ? { hash: attempt.transactionHash, confirmationStatus: "pending" } : null,
    customerAcceptance: receipt?.customerAcceptance ?? "not_requested" };
}

export function requestRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.post("/api/execute/:serviceId", async (request, reply) => {
    const auth = await authenticate(ctx, request, "execute");
    if (!await readiness(ctx)) throw new HttpError(503, "GATEWAY_NOT_READY");
    const { serviceId } = z.object({ serviceId: HashSchema }).parse(request.params);
    if (auth.sessionId && ExecuteSchema.parse(request.body).authorization.sessionId !== auth.sessionId)
      throw new HttpError(403, "CREDENTIAL_SESSION_MISMATCH");
    const row = await reserveRequest(ctx, auth.wallet, serviceId, request.body);
    if (row.requestStatus === "authorized" || row.requestStatus === "processing")
      await ctx.executionQueue.add("execute", { requestId: row.id }, { jobId: row.id });
    return reply.code(202).send(jsonSafe(await requestRecord(ctx, row.id as Hex, auth.wallet)));
  });
  app.get("/api/requests/:id", async request => {
    const auth = await authenticate(ctx, request, "request:read");
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    return jsonSafe(await requestRecord(ctx, id, auth.wallet, auth.serviceId, auth.sessionId));
  });
  app.get("/api/receipts/:id", async request => {
    const auth = await authenticate(ctx, request, "request:read");
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const row = await requestRecord(ctx, id, auth.wallet, auth.serviceId, auth.sessionId);
    if (!row.receipt) throw new HttpError(409, "RECEIPT_NOT_READY");
    return jsonSafe({ receipt: row.receipt, paymentStatus: row.paymentStatus, transaction: row.transaction });
  });
  app.post("/api/settlements", async request => {
    const auth = await authenticate(ctx, request, "execute");
    const body = z.object({ requestId: HashSchema, customerOverride: WireOverrideSchema.optional() }).strict().parse(request.body);
    const row = await ctx.db.aPIRequest.findUnique({ where: { id: body.requestId } });
    if (!row || row.customer !== auth.wallet || auth.sessionId && auth.sessionId !== row.sessionId)
      throw new HttpError(404, "UNKNOWN_REQUEST");
    if (row.requestStatus !== "completed") throw new HttpError(409, "REQUEST_NOT_COMPLETED");
    if (row.paymentStatus === "settled") return requestRecord(ctx, body.requestId, auth.wallet);
    if (body.customerOverride) {
      const pending = await ctx.db.settlementAttempt.findFirst({ where: { requestId: row.id, status: { in: ["prepared", "submitted", "mined"] } } });
      if (pending) throw new HttpError(409, "SETTLEMENT_ALREADY_PREPARED");
      const charge = fromWireCharge(row.authorization);
      const grant = fromWireOverride(body.customerOverride);
      const session = await ctx.sessions.getSession(charge.sessionId);
      const head = await ctx.client.getBlock();
      if (grant.sessionId !== charge.sessionId || grant.chargeDigest !== hashTypedData(chargeSigningPayload(ctx.config.vault, charge))
        || grant.maxTotalSpend < session.spent + BigInt(row.amount.toFixed(0)) || grant.maxTotalSpend > session.budget
        || grant.validUntil < head.timestamp || grant.validUntil > session.refundAfter
        || !await ctx.client.verifyTypedData({ ...overrideSigningPayload(ctx.config.vault, grant), address: session.customer, signature: body.customerOverride.signature }))
        throw new HttpError(401, "INVALID_CUSTOMER_OVERRIDE");
      await ctx.db.aPIRequest.update({ where: { id: row.id }, data: { customerOverride: jsonSafe(body.customerOverride) as Prisma.InputJsonValue } });
    }
    await ctx.settlementQueue.add("settle", { requestId: row.id }, { jobId: row.id + "-" + Date.now() });
    return { queued: true, requestId: row.id, paymentStatus: row.paymentStatus };
  });
  app.post("/api/requests/:id/recover", async request => {
    const auth = await authenticate(ctx, request, "execute");
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const row = await ctx.db.aPIRequest.findUnique({ where: { id } });
    if (!row || row.customer !== auth.wallet || auth.sessionId && auth.sessionId !== row.sessionId)
      throw new HttpError(404, "UNKNOWN_REQUEST");
    if (row.requestStatus === "completed" || row.requestStatus === "failed")
      return jsonSafe(await requestRecord(ctx, id, auth.wallet));
    // Recovery dispatches the original signed request. The provider's durable
    // request id prevents a second upstream execution after an unknown outcome.
    await ctx.db.aPIRequest.update({ where: { id }, data: { requestStatus: "authorized", errorCode: null } });
    const job = await ctx.executionQueue.getJob(id);
    if (job) {
      const state = await job.getState();
      if (state === "failed") await job.retry();
      else if (state === "completed") { await job.remove(); await ctx.executionQueue.add("execute", { requestId: id }, { jobId: id }); }
    } else await ctx.executionQueue.add("execute", { requestId: id }, { jobId: id });
    return jsonSafe(await requestRecord(ctx, id, auth.wallet));
  });
}
