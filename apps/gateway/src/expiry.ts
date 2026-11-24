import { paymentScope } from "./payment-scope.js";
import { fromWireCharge, Tap13EnvelopeSchema } from "@emeter/shared";
import type { GatewayContext } from "./context.js";

export async function expireReservations(ctx: GatewayContext) {
  const head = await ctx.client.getBlock();
  const rows = await ctx.db.aPIRequest.findMany({ where: { ...paymentScope(ctx), reservationActive: true,
    OR: [{ requestStatus: "indeterminate" }, { paymentStatus: "denied" }] } });
  for (const row of rows) {
    const charge = fromWireCharge(row.authorization);
    const session = await ctx.sessions.getSession(charge.sessionId);
    const receipt = await ctx.db.usageReceipt.findUnique({ where: { requestId: row.id } });
    const receiptTs = receipt ? BigInt(Tap13EnvelopeSchema.parse(receipt.envelope).ts) : undefined;
    if (session.signerRevoked || session.status === 3 || head.timestamp >= session.refundAfter
      || head.timestamp > charge.validUntil + session.settlementWindow
      || receiptTs !== undefined && head.timestamp > receiptTs + session.settlementWindow) {
      await ctx.db.aPIRequest.updateMany({ where: { id: row.id, reservationActive: true,
        paymentStatus: { not: "settled" } }, data: {
        requestStatus: row.requestStatus === "indeterminate" ? "failed" : row.requestStatus,
        paymentStatus: "failed", chargeAuthorized: false, reservationActive: false,
        errorCode: "SETTLEMENT_AUTHORIZATION_EXPIRED"
      } });
    }
  }
}
