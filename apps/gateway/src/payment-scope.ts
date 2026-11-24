import { LEGACY_DEPLOYMENT } from "@emeter/shared";
import type { GatewayContext } from "./context.js";

export function paymentScope(ctx: GatewayContext) {
  return { vault: ctx.config.vault.toLowerCase(), token: ctx.config.token.toLowerCase() };
}
export function belongsToPayment(ctx: GatewayContext, row: { vault?: string; token?: string }) {
  const scope = paymentScope(ctx);
  return (row.vault ?? LEGACY_DEPLOYMENT.vault).toLowerCase() === scope.vault
    && (row.token ?? LEGACY_DEPLOYMENT.token).toLowerCase() === scope.token;
}
