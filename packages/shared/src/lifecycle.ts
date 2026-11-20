import { z } from "zod";

export const PaymentStatusSchema = z.enum(["unsubmitted", "pending", "settled", "denied", "failed"]);
export const RequestStatusSchema = z.enum(["authorized", "processing", "indeterminate", "completed", "failed"]);
export const BaseUnitsSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type RequestStatus = z.infer<typeof RequestStatusSchema>;
export const ProtocolStatusSchema = z.object({
  name: z.literal("emeter"), phase: z.enum(["protocol-validation", "paid-gateway"]), chainId: z.literal(196),
  paidExecutionReady: z.boolean(), mainnetProofVerified: z.boolean()
});
export type ProtocolStatus = z.infer<typeof ProtocolStatusSchema>;
