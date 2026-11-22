import Fastify from "fastify";
import type { ProtocolStatus } from "@emeter/shared";
import { parseStrictJson } from "@emeter/shared";
import { z } from "zod";
import { authRoutes, HttpError } from "./auth.js";
import type { GatewayContext } from "./context.js";
import { readiness } from "./readiness.js";
import { serviceRoutes } from "./services.js";
import { sessionRoutes } from "./sessions.js";
import { requestRoutes } from "./requests.js";
import { accountRoutes } from "./account.js";

export function buildGateway(options: { recordedMainnetProofVerified?: boolean; context?: GatewayContext } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 131_072 });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, bytes, done) => {
    try { done(null, parseStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes as Buffer), 131_072)); }
    catch { done(new HttpError(400, "STRICT_JSON_REJECTED")); }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (error && typeof error === "object" && "code" in error && error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send({ error: "REQUEST_TOO_LARGE" });
    return reply.code(500).send({ error: "GATEWAY_OPERATION_FAILED" });
  });
  const status: ProtocolStatus = {
    name: "emeter", phase: options.context ? "paid-gateway" : "protocol-validation", chainId: 196,
    paidExecutionReady: false, mainnetProofVerified: options.recordedMainnetProofVerified ?? false
  };
  const ctx = options.context;
  const liveStatus = async () => {
    if (!ctx) return status;
    const [ready, head] = await Promise.all([readiness(ctx), ctx.client.getBlock().catch(() => undefined)]);
    return { ...status, paidExecutionReady: ready, vault: ctx.config.vault, registry: ctx.config.registry, token: ctx.config.token,
      decimals: 6, rpcUrl: ctx.config.rpcUrl, confirmations: ctx.config.confirmations, networkMode: ctx.config.networkMode,
      ...(head ? { anchor: { blockNumber: head.number.toString(), blockHash: head.hash, timestamp: head.timestamp.toString() } } : {}) };
  };
  app.get("/health", async () => ({ ok: true, ...await liveStatus() }));
  app.get("/api/protocol", liveStatus);
  if (ctx) {
    app.addHook("onRequest", async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && origin !== ctx.config.gatewayOrigin && !ctx.config.browserOrigins?.includes(origin))
        return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED" });
      if (origin) reply.header("access-control-allow-origin", origin).header("vary", "Origin");
    });
    app.options("/api/*", async (_request, reply) => reply.header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS")
      .header("access-control-allow-headers", "Authorization, Content-Type").header("access-control-max-age", "600").code(204).send());
    authRoutes(app, ctx); serviceRoutes(app, ctx); sessionRoutes(app, ctx); requestRoutes(app, ctx); accountRoutes(app, ctx);
  } else {
    app.post("/api/execute/:serviceId", async (_request, reply) =>
      reply.code(503).send({ error: "PAID_EXECUTION_NOT_READY", message: "Configure the deployed engine, database, providers, and worker." }));
  }
  return app;
}
