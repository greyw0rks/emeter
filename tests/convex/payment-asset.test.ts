import { expect, it } from "vitest";
import { aggregate, selectRows } from "../../convex/lib/models";
import { belongsToPayment } from "../../apps/gateway/src/payment-scope";
import type { GatewayContext } from "../../apps/gateway/src/context";
import { LEGACY_DEPLOYMENT, X_LAYER_USDC } from "@emeter/shared";

it("excludes legacy DEMO rows from USDC balances, history and reservations", () => {
  const vault = "0x0000000000000000000000000000000000000001";
  const ctx = { config: { vault, token: X_LAYER_USDC.address } } as GatewayContext;
  const old = { id: "old", customer: "alice", amount: "900000", reservationActive: true };
  const current = { id: "new", customer: "alice", vault, token: X_LAYER_USDC.address.toLowerCase(), amount: "20000", reservationActive: true };
  const rows = selectRows("aPIRequest", [old, current], { where: { customer: "alice", vault, token: X_LAYER_USDC.address.toLowerCase() } });
  expect(rows.map(row => row.id)).toEqual(["new"]);
  expect(aggregate(rows, { _sum: { amount: true } })._sum.amount).toBe("20000");
  expect(belongsToPayment(ctx, old)).toBe(false);
  expect(belongsToPayment(ctx, current)).toBe(true);
  expect(selectRows("aPIRequest", [old, current], { where: { vault: LEGACY_DEPLOYMENT.vault.toLowerCase() } }).map(row => row.id)).toEqual(["old"]);
});
