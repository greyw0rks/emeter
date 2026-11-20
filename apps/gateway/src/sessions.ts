import type { FastifyInstance } from "fastify";
import { encodeFunctionData } from "viem";
import type { Hex } from "viem";
import { z } from "zod";
import { AddressSchema, HashSchema, jsonSafe, canonicalServiceIds, serviceSetHash,
  SessionAuthorizationSchema, sessionSigningPayload, emeterVaultAbi, WalletSignatureSchema } from "@emeter/shared";
import type { SessionAuthorization } from "@emeter/shared";
import { authenticate, HttpError } from "./auth.js";
import type { GatewayContext } from "./context.js";

const unsigned = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt);
const WireSessionSchema = z.object({
  customer: AddressSchema, signer: AddressSchema, budget: unsigned, softLimit: unsigned, maxCharge: unsigned,
  expiresAt: unsigned, settlementWindow: unsigned, serviceSetHash: HashSchema, nonce: unsigned
}).strict();
export function sessionRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.post("/api/sessions", async request => {
    const auth = await authenticate(ctx, request, "execute");
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const input = z.object({ signer: AddressSchema, budget: unsigned, softLimit: unsigned, maxCharge: unsigned,
      expiresAt: unsigned, settlementWindow: unsigned, nonce: unsigned, serviceIds: z.array(HashSchema).min(1).max(16) }).strict().parse(request.body);
    const { serviceIds: selected, ...limits } = input;
    const serviceIds = canonicalServiceIds(selected);
    const authorization = SessionAuthorizationSchema.parse({ ...limits, customer: auth.wallet, serviceSetHash: serviceSetHash(serviceIds) });
    const prepared = await ctx.sessions.prepareSession(authorization, serviceIds);
    return jsonSafe(prepared);
  });
  app.post("/api/sessions/:id/authorize", async request => {
    const auth = await authenticate(ctx, request, "execute");
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const body = z.object({ authorization: WireSessionSchema, serviceIds: z.array(HashSchema), signature: WalletSignatureSchema }).strict().parse(request.body);
    const grant = SessionAuthorizationSchema.parse(body.authorization);
    if (grant.customer.toLowerCase() !== auth.wallet) throw new HttpError(403, "NOT_SESSION_CUSTOMER");
    const prepared = await ctx.sessions.prepareSession(grant, body.serviceIds);
    if (prepared.sessionId !== id) throw new HttpError(400, "SESSION_ID_MISMATCH");
    await ctx.client.simulateContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "createSession",
      args: [grant, prepared.serviceIds, body.signature], account: ctx.config.deployer });
    return { sessionId: id, status: "awaiting_chain_confirmation", transaction: { to: ctx.config.vault,
      data: encodeFunctionData({ abi: emeterVaultAbi, functionName: "createSession", args: [grant, prepared.serviceIds, body.signature] }) } };
  });
  app.get("/api/sessions/:id", async request => {
    const auth = await authenticate(ctx, request, "request:read");
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const session = await ctx.sessions.getSession(id);
    if (session.customer.toLowerCase() !== auth.wallet || auth.sessionId && auth.sessionId !== id)
      throw new HttpError(404, "UNKNOWN_SESSION");
    return jsonSafe({ sessionId: id, ...session });
  });
  app.get("/api/dashboard/usage", async request => {
    const auth = await authenticate(ctx, request, "usage:read");
    const services = await ctx.db.service.findMany({ where: { provider: auth.wallet, ...(auth.serviceId ? { id: auth.serviceId } : {}) } });
    const ids = services.map(service => service.id);
    const rows = await ctx.db.aPIRequest.findMany({ where: { serviceId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 100 });
    const total = await ctx.db.aPIRequest.count({ where: { serviceId: { in: ids } } });
    const payments = await ctx.db.aPIRequest.aggregate({ where: { serviceId: { in: ids }, paymentStatus: "settled" }, _sum: { amount: true }, _count: true });
    return { services, totalRequests: total, settledRequests: payments._count, settledBaseUnits: payments._sum.amount?.toFixed(0) ?? "0",
      recent: rows.map(row => ({ requestId: row.id, serviceId: row.serviceId, priceBaseUnits: row.amount.toFixed(0),
        requestStatus: row.requestStatus, paymentStatus: row.paymentStatus, createdAt: row.createdAt.toISOString() })) };
  });
}
