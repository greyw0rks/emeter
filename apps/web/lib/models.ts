import { z } from "zod";
import { AddressSchema, BaseUnitsSchema, HashSchema, PaymentStatusSchema, RequestStatusSchema } from "@emeter/shared";

export const SessionSchema = z.object({
  sessionId: HashSchema, customer: AddressSchema, signer: AddressSchema,
  budget: BaseUnitsSchema, balance: BaseUnitsSchema, spent: BaseUnitsSchema, refundedAmount: BaseUnitsSchema,
  softLimit: BaseUnitsSchema, maxCharge: BaseUnitsSchema, expiresAt: BaseUnitsSchema,
  executionDeadline: BaseUnitsSchema, refundAfter: BaseUnitsSchema, settlementWindow: BaseUnitsSchema,
  signerRevoked: z.boolean(), status: z.number().int().min(0).max(3), serviceIds: z.array(HashSchema), reservedBaseUnits: BaseUnitsSchema.default("0")
}).passthrough();
export type SpendingSession = z.infer<typeof SessionSchema>;
export const ActivitySchema = z.object({
  requestId: HashSchema, clientId: z.string(), sessionId: HashSchema, serviceId: HashSchema,
  serviceName: z.string(), priceVersion: z.number().int(), priceBaseUnits: BaseUnitsSchema,
  requestStatus: RequestStatusSchema, paymentStatus: PaymentStatusSchema,
  policyInputs: z.number().int().min(0).max(63).nullable(), error: z.string().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
});
export type Activity = z.infer<typeof ActivitySchema>;
export const AccountSchema = z.object({
  wallet: AddressSchema, availableBaseUnits: BaseUnitsSchema, tokenBalanceBaseUnits: BaseUnitsSchema,
  nativeBalanceWei: BaseUnitsSchema, lockedBaseUnits: BaseUnitsSchema, sessions: z.array(SessionSchema),
  stats: z.object({ totalRequests: z.number().int(), confirmedRequests: z.number().int(),
    confirmedBaseUnits: BaseUnitsSchema, reservedBaseUnits: BaseUnitsSchema, providerServices: z.number().int() }),
  requests: z.array(ActivitySchema)
});
export type AccountSummary = z.infer<typeof AccountSchema>;
export const KeysSchema = z.object({ keys: z.array(z.object({
  id: z.string().uuid(), serviceId: HashSchema.nullable(), sessionId: HashSchema.nullable(),
  scopes: z.array(z.string()), expiresAt: z.string().nullable(), revokedAt: z.string().nullable(), createdAt: z.string()
}).passthrough()) });
export type ApiCredential = z.infer<typeof KeysSchema>["keys"][number];
export const UsageSchema = z.object({ totalRequests: z.number().int(), settledRequests: z.number().int(),
  settledBaseUnits: BaseUnitsSchema, recent: z.array(z.object({ requestId: HashSchema, serviceId: HashSchema,
    priceBaseUnits: BaseUnitsSchema, requestStatus: RequestStatusSchema, paymentStatus: PaymentStatusSchema, createdAt: z.string() }))
}).passthrough();

export function paymentAmount(units: string | bigint) {
  const value = BigInt(units);
  const whole = (value / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "");
}
export function short(value: string, start = 6, end = 4) {
  return value.length <= start + end + 1 ? value : value.slice(0, start) + "…" + value.slice(-end);
}
export function time(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
export function chainTime(value: string) { return time(new Date(Number(value) * 1000).toISOString()); }
export function sessionState(session: SpendingSession, timestamp: string | undefined) {
  if (session.status === 3) return "Refunded";
  if (session.signerRevoked) return "Signer revoked";
  if (session.status === 2) return "Closing";
  if (timestamp && BigInt(timestamp) >= BigInt(session.executionDeadline)) return "Expired";
  return session.status === 1 ? "Active" : "Unknown";
}
export function canExecute(session: SpendingSession, timestamp: string | undefined) {
  return Boolean(timestamp) && sessionState(session, timestamp) === "Active" && BigInt(session.balance) > 0n;
}
