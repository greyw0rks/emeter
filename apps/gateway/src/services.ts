import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { encodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { ServiceManifestSchema, HashSchema, canonicalJson, jsonSafe, manifestHash,
  readJsonBody, verifyTap13Response, emeterRegistryAbi } from "@emeter/shared";
import type { ServiceCall } from "@emeter/shared";
import type { Prisma } from "@emeter/database";
import type { GatewayContext } from "./context.js";
import { authenticate, HttpError } from "./auth.js";
import { checkedEndpoint, dispatchSignature } from "./security.js";

export async function callProvider(ctx: GatewayContext, endpoint: string, call: ServiceCall) {
  const base = await checkedEndpoint(endpoint, ctx.config);
  const path = new URL(base).pathname.replace(/\/$/, "") + "/" + call.method;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(base + "/" + call.method, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(ctx.config.executionTimeoutMs),
    headers: { "content-type": "application/json", "x-emeter-timestamp": timestamp,
      "x-emeter-dispatch": dispatchSignature(ctx.config.dispatchSecret, path, timestamp, call) },
    body: canonicalJson(call)
  });
  return { httpStatus: response.status, body: await readJsonBody(response) };
}
export async function readServiceCatalog(ctx: GatewayContext) {
    const services = await ctx.db.service.findMany({ where: { verifiedAt: { not: null }, active: true }, orderBy: { name: "asc" } });
    const catalog = await Promise.all(services.map(async service => {
      try {
        const quote = await ctx.sessions.getQuote(service.id as Hex);
        const version = await ctx.db.priceVersion.findUnique({ where: { serviceId_version: { serviceId: service.id, version: quote.priceVersion } } });
        if (!quote.active || !version || quote.metadataHash.toLowerCase() !== version.metadataHash) return null;
        const manifest = ServiceManifestSchema.parse(version.manifest);
        if (manifestHash(manifest).toLowerCase() !== quote.metadataHash.toLowerCase()
          || manifest.priceBaseUnits !== quote.price.toString()) return null;
        return { id: service.id, name: manifest.name, description: manifest.description, method: manifest.method,
          endpoint: manifest.endpoint, manifest, provider: service.provider, priceVersion: quote.priceVersion, priceBaseUnits: quote.price.toString(),
          payout: quote.payout, signer: quote.signer, container: quote.container, active: quote.active };
      } catch { return null; }
    }));
    return { services: catalog.filter(Boolean), chainId: 196, token: ctx.config.token, decimals: 6 };
}
export function serviceRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.get("/api/services", () => readServiceCatalog(ctx));
  app.post("/api/services", async request => {
    const owner = await authenticate(ctx, request, "service:write");
    if (!owner.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const body = z.object({ manifest: ServiceManifestSchema, priceVersion: z.number().int().positive().optional() }).strict().parse(request.body);
    const manifest = body.manifest;
    const hash = manifestHash(manifest);
    await checkedEndpoint(manifest.endpoint, ctx.config);
    const probe: ServiceCall = { id: randomUUID(), method: "emeter_probe", params: { nonce: randomUUID() } };
    const answer = await callProvider(ctx, manifest.endpoint, probe);
    const verified = await verifyTap13Response({ ...answer, call: probe, container: manifest.container, signer: manifest.signer, now: Math.floor(Date.now() / 1000) });
    if (verified.outcome !== "accepted_result" || !verified.envelope
      || canonicalJson(verified.envelope.result) !== canonicalJson({ nonce: probe.params.nonce, metadataHash: hash }))
      throw new HttpError(400, "ENDPOINT_VERIFICATION_FAILED");
    let quote;
    try { quote = await ctx.sessions.getQuote(manifest.serviceId, body.priceVersion); } catch { /* Prepare registration below. */ }
    if (!quote) {
      const allowed = await ctx.client.readContract({ address: ctx.config.registry, abi: emeterRegistryAbi, functionName: "providerAllowed", args: [owner.wallet as Address] });
      if (!allowed) throw new HttpError(403, "PROVIDER_NOT_ALLOWLISTED");
      return { status: "awaiting_chain_registration", metadataHash: hash, transaction: { to: ctx.config.registry,
        data: encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService",
          args: [manifest.serviceId, manifest.payout, manifest.signer, manifest.container, BigInt(manifest.priceBaseUnits), hash] }) } };
    }
    if (quote.provider.toLowerCase() !== owner.wallet || quote.metadataHash.toLowerCase() !== hash.toLowerCase()
      || quote.price.toString() !== manifest.priceBaseUnits || !quote.active
      || quote.signer.toLowerCase() !== manifest.signer.toLowerCase() || quote.payout.toLowerCase() !== manifest.payout.toLowerCase()
      || quote.container.toLowerCase() !== manifest.container.toLowerCase()) throw new HttpError(409, "ONCHAIN_SERVICE_TERMS_MISMATCH");
    const service = await ctx.db.$transaction(async tx => {
      const row = await tx.service.upsert({ where: { id: manifest.serviceId },
        create: { id: manifest.serviceId, provider: owner.wallet, name: manifest.name, description: manifest.description,
          method: manifest.method, endpoint: manifest.endpoint, manifest: jsonSafe(manifest) as Prisma.InputJsonValue, verifiedAt: new Date() },
        update: { name: manifest.name, description: manifest.description, method: manifest.method, endpoint: manifest.endpoint,
          manifest: jsonSafe(manifest) as Prisma.InputJsonValue, verifiedAt: new Date(), active: true } });
      const terms = { price: quote.price.toString(), payout: quote.payout, signer: quote.signer, container: quote.container,
        metadataHash: quote.metadataHash.toLowerCase(), active: quote.active,
        endpoint: manifest.endpoint, method: manifest.method, manifest: jsonSafe(manifest) as Prisma.InputJsonValue };
      await tx.priceVersion.upsert({ where: { serviceId_version: { serviceId: manifest.serviceId, version: quote.priceVersion } },
        create: { serviceId: manifest.serviceId, version: quote.priceVersion, ...terms }, update: terms });
      return row;
    });
    return { status: "registered", service, priceVersion: quote.priceVersion, metadataHash: hash };
  });
  app.get("/api/services/:id/quote", async request => {
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const { version } = z.object({ version: z.coerce.number().int().positive().optional() }).parse(request.query);
    return jsonSafe(await ctx.sessions.getQuote(id, version));
  });
  app.get("/api/services/:id/manifest", async request => {
    const { id } = z.object({ id: HashSchema }).parse(request.params);
    const { version } = z.object({ version: z.coerce.number().int().positive().optional() }).parse(request.query);
    const quote = await ctx.sessions.getQuote(id, version);
    const terms = await ctx.db.priceVersion.findUnique({ where: { serviceId_version: { serviceId: id, version: quote.priceVersion } } });
    if (!terms || terms.metadataHash !== quote.metadataHash.toLowerCase()) throw new HttpError(409, "SERVICE_VERSION_NOT_VERIFIED");
    return { manifest: terms.manifest, priceVersion: quote.priceVersion, active: quote.active };
  });
}
