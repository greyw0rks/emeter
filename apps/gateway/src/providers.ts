import { keccak256, toHex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import Fastify from "fastify";
import Ajv from "ajv";
import { z } from "zod";
import { canonicalJson, ClientIdSchema, jsonSafe, manifestHash, MethodSchema, parseStrictJson, signTap13 } from "@emeter/shared";
import type { JsonValue, ServiceCall, ServiceManifest } from "@emeter/shared";
import type { Prisma } from "@emeter/database";
import type { GatewayContext } from "./context.js";
import type { Analyzer } from "./ai.js";
import { aiFailureCode } from "./ai.js";
import { dispatchVerified } from "./security.js";

export function builtInServices(ctx: GatewayContext): Record<string, ServiceManifest> {
  const terms = { version: "emeter-service-v1" as const, container: ctx.config.container,
    signer: ctx.config.providerSigner, payout: ctx.config.providerSigner };
  return {
    "text-analyzer": { ...terms, serviceId: keccak256(toHex("emeter.ai-text-analyzer.v1")),
      name: "AI Text Analyzer", description: "Summaries, sentiment, and topics from a real AI model through Otari.",
      method: "text_analyze", endpoint: ctx.config.providerOrigin + "/services/text-analyzer", priceBaseUnits: "50000" },
    "json-validator": { ...terms, serviceId: keccak256(toHex("emeter.json-validator.v1")),
      name: "JSON Validator", description: "Strict JSON parsing and JSON Schema validation with signed results.",
      method: "json_validate", endpoint: ctx.config.providerOrigin + "/services/json-validator", priceBaseUnits: "20000" }
  };
}

function safeSchema(schema: unknown, depth = 0) {
  if (depth > 32) throw new Error("SCHEMA_LIMIT");
  if (Array.isArray(schema)) for (const value of schema) safeSchema(value, depth + 1);
  else if (schema && typeof schema === "object") {
    for (const [key, value] of Object.entries(schema)) {
      if (["pattern", "patternProperties", "$ref", "$dynamicRef"].includes(key)) throw new Error("UNSUPPORTED_SCHEMA_FEATURE");
      safeSchema(value, depth + 1);
    }
  }
}
export function validateJson(input: unknown): JsonValue {
  const { json, schema } = z.object({ json: z.string().max(65_536), schema: z.record(z.string(), z.unknown()).optional() }).strict().parse(input);
  let value: JsonValue;
  try { value = parseStrictJson(json, 65_536); }
  catch { return { valid: false, errors: [{ message: "The input is not canonical-safe JSON." }] }; }
  if (!schema) return { valid: true, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value };
  safeSchema(schema);
  const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
  const validate = ajv.compile(schema);
  const valid = validate(value);
  return jsonSafe({ valid, errors: (validate.errors ?? []).slice(0, 20).map(error => ({
    path: error.instancePath, keyword: error.keyword, message: error.message ?? "Validation failed"
  })) });
}

export function buildProvider(ctx: GatewayContext, account: PrivateKeyAccount, analyzer: Analyzer) {
  const app = Fastify({ logger: false, bodyLimit: 131_072 });
  const services = builtInServices(ctx);
  const inFlight = new Map<string, { hash: string; promise: Promise<JsonValue> }>();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, raw, done) => {
    try { done(null, parseStrictJson(new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(raw as Buffer), 131_072)); }
    catch { done(new Error("STRICT_JSON_REJECTED")); }
  });
  const timestamp = async () => Number((await ctx.client.getBlock()).timestamp);
  const signed = async (call: ServiceCall, body: JsonValue, ok = true) =>
    jsonSafe(await signTap13(call, ctx.config.container, body, ok, await timestamp(), account.signMessage));
  app.setErrorHandler(async (error, request, reply) => {
    const method = request.url.split("?")[0]!.split("/").pop() ?? "";
    if (!MethodSchema.safeParse(method).success) return reply.code(404).send({ error: "UNKNOWN_ROUTE" });
    const body = request.body as Record<string, unknown> | undefined;
    const id = ClientIdSchema.safeParse(body?.id);
    const parsed = id.success && body && (body.params === undefined || body.params !== null && typeof body.params === "object" && !Array.isArray(body.params));
    try {
      if (!parsed) {
        const oversized = error && typeof error === "object" && "code" in error && error.code === "FST_ERR_CTP_BODY_TOO_LARGE";
        return reply.code(oversized ? 413 : 400).send(await signed({ id: "", method, params: {} },
          { code: "BAD_REQUEST", message: "Invalid request." }, false));
      }
      // A valid request followed by a storage or signing failure has an unknown
      // completion. Calling it malformed would release the customer's budget.
      return reply.code(503).send(await signed({ id: id.data!, method, params: (body!.params ?? {}) as Record<string, JsonValue> },
        { code: "INTERNAL", message: "Request completion could not be confirmed.", data: { completion: "unknown" } }, false));
    } catch { return reply.code(503).send({ error: "PROVIDER_UNAVAILABLE" }); }
  });
  app.get("/health", async () => ({ ok: true, aiReady: true, model: analyzer.model, runtime: analyzer.runtime }));
  app.get("/.well-known/emeter.json", async () => ({ services: Object.values(services) }));
  app.post("/services/:slug/:method", async (request, reply) => {
    const { slug, method } = z.object({ slug: z.string(), method: MethodSchema }).parse(request.params);
    const manifest = services[slug];
    if (!manifest) return reply.code(404).send({ error: "UNKNOWN_SERVICE" });
    const body = request.body as Record<string, unknown>;
    const id = ClientIdSchema.safeParse(body?.id);
    let call: ServiceCall = { id: id.success ? id.data : "", method, params: {} };
    if (!id.success) return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Invalid request id." }, false));
    if (body.params !== undefined && (!body.params || typeof body.params !== "object" || Array.isArray(body.params)))
      return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Params must be an object." }, false));
    call = { ...call, params: (body.params ?? {}) as Record<string, JsonValue> };
    if (body.method !== undefined && body.method !== method)
      return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Method does not match its route." }, false));
    if (!dispatchVerified(ctx.config.dispatchSecret, request.url.split("?")[0]!,
      String(request.headers["x-emeter-timestamp"] ?? ""), request.body, String(request.headers["x-emeter-dispatch"] ?? "")))
      return reply.code(401).send(await signed(call, { code: "BAD_REQUEST", message: "Gateway dispatch authorization required." }, false));
    if (method === "emeter_probe")
      return signed(call, { nonce: call.params.nonce ?? null, metadataHash: manifestHash(manifest) });
    if (method === "receipt") {
      const lookup = z.object({ id: z.string().min(1), requestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().safeParse(call.params);
      if (lookup.success) {
        const record = await ctx.db.providerExecution.findFirst({ where: {
          aiReceipt: { path: ["id"], equals: lookup.data.id }
        }, orderBy: { createdAt: "desc" } });
        const receipt = record?.aiReceipt as Record<string, unknown> | null;
        const params = receipt?.params as Record<string, unknown> | undefined;
        if (receipt && (!lookup.data.requestSha256 || params?.requestSha256 === lookup.data.requestSha256))
          return signed(call, jsonSafe(receipt));
      }
      return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "No matching receipt." }, false));
    }
    if (method !== manifest.method)
      return reply.code(404).send(await signed(call, { code: "METHOD_NOT_FOUND", message: "The service does not offer this method." }, false));
    const params = z.object({ sessionId: z.string(), serviceId: z.literal(manifest.serviceId), priceVersion: z.number().int().positive(),
      input: z.unknown() }).strict().safeParse(call.params);
    if (!params.success)
      return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Invalid service parameters." }, false));
    const textInput = method === "text_analyze"
      ? z.object({ text: z.string().min(1).max(8000) }).strict().safeParse(params.data.input) : undefined;
    if (textInput && !textInput.success)
      return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Provide text of 1 to 8000 characters." }, false));
    const recordId = keccak256(toHex(call.id));
    const hash = keccak256(toHex(canonicalJson({ method, params: call.params })));
    const existing = await ctx.db.providerExecution.findUnique({ where: { id: recordId } });
    if (existing) {
      if (existing.requestHash !== hash) return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Request id was reused." }, false));
      if (existing.envelope) return existing.envelope;
      const running = inFlight.get(recordId);
      if (running && running.hash === hash) return running.promise;
      // A process stopped during an upstream operation. Its completion is
      // unknown; do not silently execute and bill the upstream a second time.
      return reply.code(500).send(await signed(call, { code: "INTERNAL", message: "Request completion could not be recovered.",
        data: { completion: "unknown" } }, false));
    }
    const running = inFlight.get(recordId);
    if (running) {
      if (running.hash !== hash)
        return reply.code(400).send(await signed(call, { code: "BAD_REQUEST", message: "Request id was reused." }, false));
      return running.promise;
    }
    const work = (async () => {
      try { await ctx.db.providerExecution.create({ data: { id: recordId, requestHash: hash, status: "processing" } }); }
      catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
        const claimed = await ctx.db.providerExecution.findUniqueOrThrow({ where: { id: recordId } });
        if (claimed.requestHash !== hash)
          return signed(call, { code: "BAD_REQUEST", message: "Request id was reused." }, false);
        if (claimed.envelope) return claimed.envelope as JsonValue;
        return signed(call, { code: "INTERNAL", message: "Another provider process owns this request.",
          data: { completion: "unknown" } }, false);
      }
      let envelope: JsonValue;
      let aiReceipt: Prisma.InputJsonValue | undefined;
      try {
        let result: JsonValue;
        if (method === "text_analyze") {
          result = await analyzer.analyze(textInput!.data!.text);
          const evidence = (result as Record<string, JsonValue>).usageEvidence as Record<string, JsonValue> | undefined;
          if (evidence?.receipt) aiReceipt = jsonSafe(evidence.receipt) as Prisma.InputJsonValue;
        } else result = validateJson(params.data.input);
        envelope = await signed(call, result);
      } catch (error) {
        const inputError = error instanceof z.ZodError && method !== "text_analyze"
          || error instanceof Error && ["SCHEMA_LIMIT", "UNSUPPORTED_SCHEMA_FEATURE"].includes(error.message);
        envelope = await signed(call, { code: inputError ? "BAD_REQUEST" : "INTERNAL",
          message: inputError ? "Invalid or unsupported input schema." : "Service execution failed.",
          ...(method === "text_analyze" ? { data: { failureCode: aiFailureCode(error) } } : {}) }, false);
      }
      await ctx.db.providerExecution.update({ where: { id: recordId }, data: {
        status: "completed", envelope: envelope as Prisma.InputJsonValue, ...(aiReceipt ? { aiReceipt } : {})
      } });
      return envelope;
    })();
    inFlight.set(recordId, { hash, promise: work });
    try { return await work; } finally { inFlight.delete(recordId); }
  });
  return app;
}
