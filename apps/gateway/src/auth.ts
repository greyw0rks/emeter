import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AddressSchema, HashSchema, WalletSignatureSchema } from "@emeter/shared";
import { getAddress } from "viem";
import type { GatewayContext } from "./context.js";
import { secretHash } from "./security.js";

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string) { super(code); }
}
export type Principal = { wallet: string; scopes: string[]; serviceId?: string; sessionId?: string };
function credentialDigest(ctx: GatewayContext, request: FastifyRequest) {
  if (ctx.credentialHash) return ctx.credentialHash;
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  if (!token || token === request.headers.authorization) throw new HttpError(401, "AUTHENTICATION_REQUIRED");
  return secretHash(token);
}
function issueCredential(ctx: GatewayContext, prefix = "") {
  if (ctx.issuedCredentialHash) return { value: "", hash: ctx.issuedCredentialHash };
  const value = prefix + randomBytes(32).toString("base64url");
  return { value, hash: secretHash(value) };
}
export async function authenticate(ctx: GatewayContext, request: FastifyRequest, scope?: string): Promise<Principal> {
  const hash = credentialDigest(ctx, request);
  const [session, key] = await Promise.all([
    ctx.db.authSession.findUnique({ where: { tokenHash: hash } }),
    ctx.db.aPIKey.findUnique({ where: { keyHash: hash } })
  ]);
  if (session && !session.revokedAt && session.expiresAt > new Date()) return { wallet: session.wallet, scopes: ["*"] };
  if (key && !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date()) && (!scope || key.scopes.includes(scope)))
    return { wallet: key.wallet, scopes: key.scopes,
      ...(key.serviceId ? { serviceId: key.serviceId } : {}), ...(key.sessionId ? { sessionId: key.sessionId } : {}) };
  throw new HttpError(401, "INVALID_OR_EXPIRED_CREDENTIAL");
}
export function authRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.post("/api/auth/challenge", async request => {
    const { wallet } = z.object({ wallet: AddressSchema }).strict().parse(request.body);
    const normalized = getAddress(wallet).toLowerCase();
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = "emeter gateway authentication\nOrigin: " + ctx.config.gatewayOrigin
      + "\nChain ID: 196\nWallet: " + normalized + "\nNonce: " + id + "\nExpires at: " + expiresAt.toISOString();
    await ctx.db.authChallenge.create({ data: { id, wallet: normalized, message, expiresAt } });
    return { id, message, expiresAt: expiresAt.toISOString() };
  });
  app.post("/api/auth/verify", async request => {
    const body = z.object({ id: z.string().uuid(), signature: WalletSignatureSchema }).strict().parse(request.body);
    const challenge = await ctx.db.authChallenge.findUnique({ where: { id: body.id } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw new HttpError(401, "CHALLENGE_EXPIRED_OR_CONSUMED");
    if (!await ctx.client.verifyMessage({ address: getAddress(challenge.wallet), message: challenge.message, signature: body.signature }))
      throw new HttpError(401, "INVALID_WALLET_SIGNATURE");
    const token = issueCredential(ctx);
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await ctx.db.$transaction(async tx => {
      const used = await tx.authChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() } });
      if (used.count !== 1) throw new HttpError(401, "CHALLENGE_EXPIRED_OR_CONSUMED");
      await tx.user.upsert({ where: { wallet: challenge.wallet }, create: { wallet: challenge.wallet }, update: {} });
      await tx.authSession.create({ data: { tokenHash: token.hash, wallet: challenge.wallet, expiresAt } });
    });
    return { token: token.value, wallet: challenge.wallet, expiresAt: expiresAt.toISOString() };
  });
  app.post("/api/auth/logout", async request => {
    await authenticate(ctx, request);
    const hash = credentialDigest(ctx, request);
    await ctx.db.authSession.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
    await ctx.db.aPIKey.updateMany({ where: { keyHash: hash }, data: { revokedAt: new Date() } });
    return { revoked: true };
  });
  app.post("/api/keys", async request => {
    const auth = await authenticate(ctx, request, "keys:write");
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const body = z.object({ serviceId: HashSchema.optional(), sessionId: HashSchema.optional(),
      scopes: z.array(z.enum(["execute", "usage:read", "request:read"])).min(1).max(3)
    }).strict().refine(v => Boolean(v.serviceId) !== Boolean(v.sessionId), "Choose one credential scope").parse(request.body);
    let expiresAt: Date | undefined;
    if (body.sessionId) {
      const session = await ctx.sessions.getSession(body.sessionId);
      if (session.customer.toLowerCase() !== auth.wallet || session.status !== 1 || session.signerRevoked)
        throw new HttpError(403, "NOT_ACTIVE_SESSION_CUSTOMER");
      if (body.scopes.includes("usage:read")) throw new HttpError(400, "INVALID_SESSION_KEY_SCOPE");
      expiresAt = new Date(Number(session.refundAfter) * 1000);
      if (expiresAt <= new Date()) throw new HttpError(409, "SESSION_EXPIRED");
    } else {
      const service = await ctx.db.service.findUnique({ where: { id: body.serviceId! } });
      if (!service || service.provider !== auth.wallet) throw new HttpError(403, "NOT_SERVICE_OWNER");
      if (body.scopes.includes("execute")) throw new HttpError(400, "INVALID_PROVIDER_KEY_SCOPE");
    }
    const key = issueCredential(ctx, "emeter_");
    const record = await ctx.db.aPIKey.create({ data: { wallet: auth.wallet,
      ...(body.serviceId ? { serviceId: body.serviceId } : {}), ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      scopes: body.scopes, keyHash: key.hash, ...(expiresAt ? { expiresAt } : {}) } });
    return { id: record.id, key: key.value, serviceId: body.serviceId ?? null, sessionId: body.sessionId ?? null,
      scopes: body.scopes, expiresAt: expiresAt?.toISOString() ?? null, displayOnce: true };
  });
  app.delete("/api/keys/:id", async request => {
    const auth = await authenticate(ctx, request);
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await ctx.db.aPIKey.updateMany({ where: { id, wallet: auth.wallet }, data: { revokedAt: new Date() } });
    return { revoked: true };
  });
  app.get("/api/keys", async request => {
    const auth = await authenticate(ctx, request);
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    return { keys: await ctx.db.aPIKey.findMany({ where: { wallet: auth.wallet }, select: {
      id: true, serviceId: true, sessionId: true, scopes: true, createdAt: true, expiresAt: true, revokedAt: true
    }, orderBy: { createdAt: "desc" } }) };
  });
}
