import { z } from "zod";
import { keccak256, toHex } from "viem";
import type { Address, Hex } from "viem";
import { canonicalJson, parseStrictJson } from "./json.js";
import type { JsonValue } from "./json.js";
import { tap13DigestFromHashes, verifyTap13Hashes } from "./index.js";
import { SessionChargeAuthorizationSchema } from "./payments.js";
import { PaymentStatusSchema, RequestStatusSchema } from "./lifecycle.js";

export const HashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase() as Hex);
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v as Address);
export const SignatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform(v => v as Hex);
export const WalletSignatureSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(8194).transform(v => v as Hex);
export const ClientIdSchema = z.string().min(1).max(128).refine(v => {
  if (v.length > 128) return false;
  try { canonicalJson(v); return true; } catch { return false; }
});
export const MethodSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
export const WireChargeSchema = z.object({
  sessionId: HashSchema, requestId: HashSchema, requestHash: HashSchema, serviceId: HashSchema,
  priceVersion: z.number().int().min(1).max(2 ** 32 - 1),
  maxAmount: z.string().regex(/^[1-9][0-9]*$/), nonce: z.string().regex(/^(0|[1-9][0-9]*)$/),
  issuedAt: z.string().regex(/^(0|[1-9][0-9]*)$/), validUntil: z.string().regex(/^(0|[1-9][0-9]*)$/)
}).strict();
export function fromWireCharge(value: unknown) {
  const v = WireChargeSchema.parse(value);
  return SessionChargeAuthorizationSchema.parse({ ...v, maxAmount: BigInt(v.maxAmount), nonce: BigInt(v.nonce),
    issuedAt: BigInt(v.issuedAt), validUntil: BigInt(v.validUntil) });
}
export function jsonSafe(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v)) as JsonValue;
}
export const ServiceManifestSchema = z.object({
  version: z.literal("emeter-service-v1"), serviceId: HashSchema, name: z.string().min(1).max(80),
  description: z.string().max(500), method: MethodSchema, endpoint: z.string().url(),
  priceBaseUnits: z.string().regex(/^[1-9][0-9]*$/), container: AddressSchema,
  signer: AddressSchema, payout: AddressSchema
}).strict();
export type ServiceManifest = z.infer<typeof ServiceManifestSchema>;
export function manifestHash(manifest: ServiceManifest): Hex { return keccak256(toHex(canonicalJson(manifest))); }
export type ServiceCall = { id: string; method: string; params: Record<string, JsonValue> };
export function requestHash(call: ServiceCall): Hex { return keccak256(toHex(canonicalJson({ method: call.method, params: call.params }))); }
export const Tap13EnvelopeSchema = z.object({
  id: z.string().max(128).refine(v => v.length <= 128), ok: z.boolean(), result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string(), data: z.record(z.string(), z.unknown()).optional() }).optional(),
  container: AddressSchema, ts: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  block: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), sig: SignatureSchema
}).passthrough().superRefine((v, ctx) => {
  if (v.ok ? !("result" in v) || "error" in v : !("error" in v) || "result" in v)
    ctx.addIssue({ code: "custom", message: "Response body does not match ok" });
});
export type Tap13Envelope = z.infer<typeof Tap13EnvelopeSchema>;

export const GatewayRequestRecordSchema = z.object({
  requestId: HashSchema, clientId: ClientIdSchema, sessionId: HashSchema, serviceId: HashSchema,
  priceVersion: z.number().int().positive(), requestHash: HashSchema,
  serviceManifest: ServiceManifestSchema,
  call: z.object({ id: ClientIdSchema, method: MethodSchema, params: z.record(z.string(), z.unknown()) }).strict(),
  authorization: WireChargeSchema, chargeSignature: WalletSignatureSchema,
  requestStatus: RequestStatusSchema, paymentStatus: PaymentStatusSchema,
  chargeAuthorized: z.boolean(), priceBaseUnits: z.string().regex(/^[1-9][0-9]*$/),
  policyInputs: z.number().int().min(0).max(63).nullable(), data: z.unknown(), error: z.string().nullable(),
  receipt: z.object({ envelope: Tap13EnvelopeSchema, digest: HashSchema, bodyHash: HashSchema,
    signer: AddressSchema, providerVerified: z.boolean(), reportedUsage: z.unknown().nullable(), aiReceipt: z.unknown().nullable()
  }).passthrough().nullable(),
  transaction: z.object({ hash: HashSchema, confirmationStatus: z.enum(["pending", "confirmed"]),
    blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(), policyInputs: z.number().int().min(0).max(63).optional()
  }).nullable(), customerAcceptance: z.string()
}).passthrough();

export async function signTap13(call: ServiceCall, container: Address, body: JsonValue, ok: boolean,
  timestamp: number, signMessage: (message: { message: { raw: Hex } }) => Promise<Hex>) {
  const hashes = { container, idHash: keccak256(toHex(call.id)), requestHash: requestHash(call),
    bodyHash: keccak256(toHex(canonicalJson(body))), ts: BigInt(timestamp), ok };
  const sig = await signMessage({ message: { raw: tap13DigestFromHashes(hashes) } });
  return { id: call.id, ok, ...(ok ? { result: body } : { error: body }), container, ts: timestamp, sig };
}

export async function verifyTap13Response(input: { call: ServiceCall; container: Address; signer: Address;
  httpStatus: number; body: string; now: number; maxSkew?: number }) {
  if (input.httpStatus === 429) return { outcome: "rate_limited" as const };
  let parsed: JsonValue;
  try { parsed = parseStrictJson(input.body); } catch { return { outcome: "transport_failure" as const }; }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || typeof parsed.sig !== "string")
    return { outcome: "transport_failure" as const };
  const result = Tap13EnvelopeSchema.safeParse(parsed);
  if (!result.success) return { outcome: "binding_failure" as const };
  const envelope = result.data;
  const verify = async (call: ServiceCall) => verifyTap13Hashes({
    container: input.container, idHash: keccak256(toHex(call.id)), requestHash: requestHash(call),
    bodyHash: keccak256(toHex(canonicalJson(envelope.ok ? envelope.result : envelope.error))),
    ts: BigInt(envelope.ts), ok: envelope.ok
  }, envelope.sig, input.signer);
  try {
    if (!envelope.ok && envelope.error?.code === "BAD_REQUEST"
      && (envelope.id === "" || envelope.id === input.call.id)
      && await verify({ id: envelope.id, method: input.call.method, params: {} }))
      return { outcome: "own_request_malformed" as const, envelope };
    if (envelope.id !== input.call.id || envelope.container.toLowerCase() !== input.container.toLowerCase()
      || Math.abs(input.now - envelope.ts) > (input.maxSkew ?? 300) || !await verify(input.call))
      return { outcome: "binding_failure" as const };
    const bodyHash = keccak256(toHex(canonicalJson(envelope.ok ? envelope.result : envelope.error)));
    const receipt = { requestId: keccak256(toHex(input.call.id)), requestHash: requestHash(input.call),
      bodyHash, timestamp: BigInt(envelope.ts), ok: envelope.ok };
    const digest = tap13DigestFromHashes({ container: input.container, idHash: receipt.requestId,
      requestHash: receipt.requestHash, bodyHash, ts: receipt.timestamp, ok: receipt.ok });
    return { outcome: envelope.ok ? "accepted_result" as const : "accepted_error" as const, envelope, receipt, digest };
  } catch { return { outcome: "binding_failure" as const }; }
}
