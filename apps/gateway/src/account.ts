import { paymentScope } from "./payment-scope.js";
import type { FastifyInstance } from "fastify";
import { parseAbi } from "viem";
import type { Address, Hex } from "viem";
import { emeterVaultAbi, jsonSafe } from "@emeter/shared";
import type { GatewayContext } from "./context.js";
import { authenticate, HttpError } from "./auth.js";

export function accountRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.get("/api/account", async request => {
    const auth = await authenticate(ctx, request, "request:read");
    if (!auth.scopes.includes("*")) throw new HttpError(403, "WALLET_LOGIN_REQUIRED");
    const address = auth.wallet as Address;
    const [available, tokenBalance, nativeBalance, indexed, rows, counts, payments, reserved, services, providerServices, sessionReservations] = await Promise.all([
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [address] }),
      ctx.client.readContract({ address: ctx.config.token, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [address] }),
      ctx.client.getBalance({ address }),
      ctx.db.spendingSession.findMany({ where: { ...paymentScope(ctx), customer: auth.wallet }, orderBy: { indexedBlock: "desc" }, take: 50 }),
      ctx.db.aPIRequest.findMany({ where: { ...paymentScope(ctx), customer: auth.wallet }, orderBy: { createdAt: "desc" }, take: 50 }),
      ctx.db.aPIRequest.count({ where: { ...paymentScope(ctx), customer: auth.wallet } }),
      ctx.db.aPIRequest.aggregate({ where: { ...paymentScope(ctx), customer: auth.wallet, paymentStatus: "settled" }, _sum: { amount: true }, _count: true }),
      ctx.db.aPIRequest.aggregate({ where: { ...paymentScope(ctx), customer: auth.wallet, reservationActive: true }, _sum: { amount: true } }),
      ctx.db.service.findMany({ select: { id: true, name: true } }),
      ctx.db.service.count({ where: { provider: auth.wallet } }),
      ctx.db.aPIRequest.groupBy({ by: ["sessionId"], where: { ...paymentScope(ctx), customer: auth.wallet, reservationActive: true }, _sum: { amount: true } })
    ]);
    const ids = services.map(service => service.id as Hex);
    const sessions = await Promise.all(indexed.map(async row => {
      const state = await ctx.sessions.getSession(row.id as Hex);
      const allowed = await Promise.all(ids.map(id => ctx.client.readContract({ address: ctx.config.vault,
        abi: emeterVaultAbi, functionName: "sessionServiceAllowed", args: [row.id as Hex, id] })));
      return { sessionId: row.id, ...state, serviceIds: ids.filter((_id, i) => allowed[i]),
        reservedBaseUnits: sessionReservations.find(value => value.sessionId === row.id)?._sum.amount?.toFixed(0) ?? "0" };
    }));
    const names = new Map(services.map(service => [service.id, service.name]));
    return jsonSafe({ wallet: auth.wallet, availableBaseUnits: available.toString(), tokenBalanceBaseUnits: tokenBalance.toString(),
      nativeBalanceWei: nativeBalance.toString(), lockedBaseUnits: sessions.reduce((sum, row) => sum + row.balance, 0n).toString(),
      sessions, stats: { totalRequests: counts, confirmedRequests: payments._count,
        confirmedBaseUnits: payments._sum.amount?.toFixed(0) ?? "0", reservedBaseUnits: reserved._sum.amount?.toFixed(0) ?? "0", providerServices },
      requests: rows.map(row => ({ requestId: row.id, clientId: row.clientId, sessionId: row.sessionId, serviceId: row.serviceId,
        serviceName: names.get(row.serviceId) ?? "Registered service", priceVersion: row.priceVersion,
        priceBaseUnits: row.amount.toFixed(0), requestStatus: row.requestStatus, paymentStatus: row.paymentStatus,
        policyInputs: row.policyInputs, error: row.errorCode, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) });
  });
}
