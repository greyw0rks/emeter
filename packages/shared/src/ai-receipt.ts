import { z } from "zod";
import { canonicalJson, parseStrictJson } from "./json.js";
import { keccak256, toHex } from "viem";
import type { Address } from "viem";
import { verifyTap13Hashes } from "./index.js";
import { requestHash } from "./gateway.js";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const AiUsageSchema = z.object({
  prompt_tokens: count, completion_tokens: count, total_tokens: count,
  cache_read_tokens: count.optional(), cache_write_tokens: count.optional(),
  cache_write_1h_tokens: count.optional(), reasoning_tokens: count.optional(),
  other: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), count.min(1)).optional()
}).strict().refine(u => (u.cache_read_tokens ?? 0) + (u.cache_write_tokens ?? 0) <= u.prompt_tokens
  && (u.cache_write_1h_tokens ?? 0) <= (u.cache_write_tokens ?? 0)
  && (u.reasoning_tokens ?? 0) <= u.completion_tokens, "Inconsistent reported usage");
export type AiUsage = z.infer<typeof AiUsageSchema>;
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,8})?$/);
export const AiPriceSchema = z.object({
  currency: z.enum(["BEM", "BNB", "USDT", "USDC", "ETH", "USD1", "USD"]),
  unit: z.literal("1M tokens"), input: decimal, output: decimal,
  cacheRead: decimal.optional(), cacheWrite: decimal.optional(), cacheWrite1h: decimal.optional(), reasoning: decimal.optional()
}).strict();
export type AiPrice = z.infer<typeof AiPriceSchema>;
export const AnalysisSchema = z.object({ summary: z.string().max(500), sentiment: z.enum(["positive", "negative", "neutral"]),
  topics: z.array(z.string().max(80)).max(5) }).strict();
export function parseAnalysisOutput(text: string) {
  let body = text.trim();
  const fenced = body.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced) body = fenced[1]!;
  return AnalysisSchema.parse(parseStrictJson(body));
}
function priceBaseUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}
/** TAP-17 §4.3: integer weighted pricing, one ceiling division, eight digits.
 * This reports usage cost. It never substitutes for a DEMO settlement receipt.
 */
export function usageAmount(rawUsage: AiUsage, rawPrice: AiPrice) {
  const u = AiUsageSchema.parse(rawUsage);
  const p = AiPriceSchema.parse(rawPrice);
  const cr = BigInt(u.cache_read_tokens ?? 0), cw = BigInt(u.cache_write_tokens ?? 0), cw1h = BigInt(u.cache_write_1h_tokens ?? 0);
  const rs = p.reasoning === undefined ? 0n : BigInt(u.reasoning_tokens ?? 0);
  const weighted = priceBaseUnits(p.input) * (BigInt(u.prompt_tokens) - cr - cw)
    + priceBaseUnits(p.cacheRead ?? p.input) * cr
    + priceBaseUnits(p.cacheWrite ?? p.input) * (cw - cw1h)
    + priceBaseUnits(p.cacheWrite1h ?? p.cacheWrite ?? p.input) * cw1h
    + priceBaseUnits(p.output) * (BigInt(u.completion_tokens) - rs)
    + (p.reasoning === undefined ? 0n : priceBaseUnits(p.reasoning) * rs);
  const amount = (weighted + 999_999n) / 1_000_000n;
  return (amount / 100_000_000n).toString() + "." + (amount % 100_000_000n).toString().padStart(8, "0");
}

export function anthropicUsage(body: unknown, status: number): AiUsage | null {
  if (status < 200 || status >= 300 || !body || typeof body !== "object") return null;
  const source = (body as Record<string, unknown>).usage;
  if (!source || typeof source !== "object") return null;
  const u = source as Record<string, unknown>;
  if (!count.safeParse(u.input_tokens).success) return null;
  // TAP-17 §7.3 reads these cache fields only when they are counts.
  const cr = count.safeParse(u.cache_read_input_tokens).success ? u.cache_read_input_tokens : undefined;
  const cw = count.safeParse(u.cache_creation_input_tokens).success ? u.cache_creation_input_tokens : undefined;
  const prompt = Number(u.input_tokens) + Number(cr ?? 0) + Number(cw ?? 0);
  const creation = u.cache_creation as Record<string, unknown> | undefined;
  const toolUse = u.server_tool_use as Record<string, unknown> | undefined;
  const raw = {
    prompt_tokens: prompt, completion_tokens: u.output_tokens ?? 0,
    total_tokens: prompt + Number(u.output_tokens ?? 0),
    ...(cr === undefined ? {} : { cache_read_tokens: cr }),
    ...(cw === undefined ? {} : { cache_write_tokens: cw }),
    ...(count.safeParse(creation?.ephemeral_1h_input_tokens).success ? { cache_write_1h_tokens: creation!.ephemeral_1h_input_tokens } : {}),
    ...(count.safeParse(toolUse?.web_search_requests).success && Number(toolUse?.web_search_requests) > 0
      ? { other: { web_search_requests: toolUse!.web_search_requests } } : {})
  };
  const parsed = AiUsageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export const AiReceiptSchema = z.object({
  id: z.string().regex(/^[!-~]{1,128}$/), ok: z.literal(true),
  container: z.string().regex(/^0x[0-9a-fA-F]{40}$/), ts: count,
  method: z.literal("anthropic_messages"),
  params: z.object({ path: z.literal("/v1/messages"), requestSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  result: z.object({
    model: z.string().min(1).max(256).refine(v => v.length <= 256).nullable(), usage: AiUsageSchema.nullable(),
    responseSha256: z.string().regex(/^[0-9a-f]{64}$/), stream: z.literal(false), complete: z.boolean(),
    status: z.number().int().min(100).max(599),
    prices: z.array(z.object({ currency: AiPriceSchema.shape.currency,
      amount: z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{8}$/) }).strict()).nullable(),
    modelMatchedBy: z.enum(["response", "request"]).optional(), unpriced: z.array(z.string()).optional()
  }).strict(),
  sig: z.string().regex(/^0x[0-9a-fA-F]{130}$/)
}).strict().refine(v => v.result.status >= 200 && v.result.status < 300 || !v.result.complete);

export function aiReceiptRequestHashInput(receipt: z.infer<typeof AiReceiptSchema>) {
  return { method: receipt.method, params: receipt.params };
}
export function validateAiReceipt(value: unknown) {
  const receipt = AiReceiptSchema.parse(value);
  canonicalJson(receipt);
  return receipt;
}

const AiEvidenceSchema = z.object({
  receipt: AiReceiptSchema,
  requestBodyBase64: z.string().max(1_398_104), responseBodyBase64: z.string().max(1_398_104),
  status: z.number().int().min(100).max(599), format: z.literal("anthropic-messages"),
  priceTable: z.array(AiPriceSchema).max(7).optional(), priceModel: z.string().min(1).max(256).optional()
}).strict();

function base64Bytes(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("INVALID_AI_EVIDENCE_ENCODING");
  const binary = atob(value);
  if (btoa(binary) !== value || binary.length > 1_048_576) throw new Error("INVALID_AI_EVIDENCE_ENCODING");
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}

/** Checks the non-streaming TAP-17 receipt against retained body bytes and
 * reported usage. It attributes a provider statement, not upstream authenticity
 * or AI correctness, and it never establishes a DEMO payment.
 */
export async function verifyAiEvidence(value: unknown, identity: { container: Address; signer: Address; text?: string; analysis?: unknown }) {
  const evidence = AiEvidenceSchema.parse(value);
  const { receipt } = evidence;
  const requestBytes = base64Bytes(evidence.requestBodyBase64);
  const responseBytes = base64Bytes(evidence.responseBodyBase64);
  if (receipt.container.toLowerCase() !== identity.container.toLowerCase() || evidence.status !== receipt.result.status
    || receipt.params.requestSha256 !== await sha256(requestBytes)
    || receipt.result.responseSha256 !== await sha256(responseBytes)) throw new Error("AI_EVIDENCE_BINDING_FAILED");
  const decode = (bytes: Uint8Array) => new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const request = parseStrictJson(decode(requestBytes)) as Record<string, unknown>;
  const response = parseStrictJson(decode(responseBytes)) as Record<string, unknown>;
  const usage = anthropicUsage(response, evidence.status);
  if (canonicalJson(usage) !== canonicalJson(receipt.result.usage)) throw new Error("AI_REPORTED_USAGE_MISMATCH");
  const reported = typeof response?.model === "string" && response.model.length > 0 && response.model.length <= 256 ? response.model : undefined;
  const requested = typeof request?.model === "string" ? request.model : undefined;
  const candidate = reported ?? requested;
  const matched = evidence.priceTable !== undefined && candidate === evidence.priceModel;
  const prices = matched && usage ? evidence.priceTable!.map(price => ({ currency: price.currency, amount: usageAmount(usage, price) })) : null;
  const unpriced = prices !== null && usage?.other ? Object.keys(usage.other).sort() : undefined;
  if (new Set(evidence.priceTable?.map(price => price.currency)).size !== (evidence.priceTable?.length ?? 0)
    || receipt.result.model !== (reported ?? (matched ? requested : null))
    || receipt.result.complete !== (evidence.status >= 200 && evidence.status < 300 && response?.type !== "error")
    || canonicalJson(receipt.result.prices) !== canonicalJson(prices)
    || receipt.result.modelMatchedBy !== (matched ? reported ? "response" : "request" : undefined)
    || canonicalJson(receipt.result.unpriced ?? null) !== canonicalJson(unpriced ?? null))
    throw new Error("AI_REPORTED_PRICE_OR_COMPLETION_MISMATCH");
  if (identity.text !== undefined) {
    const messages = request?.messages;
    if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== "user" || messages[0]?.content !== identity.text)
      throw new Error("AI_INPUT_BINDING_FAILED");
  }
  if (identity.analysis !== undefined) {
    if (!Array.isArray(response?.content)) throw new Error("AI_OUTPUT_BINDING_FAILED");
    const output = response.content.filter(block => block?.type === "text").map(block => block.text).join("");
    if (canonicalJson(parseAnalysisOutput(output)) !== canonicalJson(identity.analysis)) throw new Error("AI_OUTPUT_BINDING_FAILED");
  }
  if (!await verifyTap13Hashes({ container: identity.container, idHash: keccak256(toHex(receipt.id)),
    requestHash: requestHash({ id: receipt.id, method: receipt.method, params: receipt.params }),
    bodyHash: keccak256(toHex(canonicalJson(receipt.result))), ts: BigInt(receipt.ts), ok: true
  }, receipt.sig as `0x${string}`, identity.signer)) throw new Error("AI_RECEIPT_SIGNATURE_INVALID");
  return { receipt, request, response, priceVerified: prices !== null };
}
