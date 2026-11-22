import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const reserve = internalMutation({
  args: { requestId: v.string(), maximumUsdNano: v.string() },
  handler: async (ctx, args) => {
    if (!/^[1-9][0-9]*$/.test(args.maximumUsdNano)) throw new ConvexError({ code: "INVALID_AI_COST_BOUND" });
    const existing = await ctx.db.query("aiReservations").withIndex("by_request", q => q.eq("requestId", args.requestId)).unique();
    if (existing) throw new ConvexError({ code: "AI_REQUEST_ALREADY_STARTED" });
    const rows = await ctx.db.query("aiReservations").collect();
    const used = rows.reduce((total, row) => total + BigInt(row.actualUsdNano ?? row.maximumUsdNano), 0n);
    const budget = BigInt(process.env.EMETER_AI_USD_BUDGET_NANO ?? "10000000");
    if (budget <= 0n || used + BigInt(args.maximumUsdNano) > budget) throw new ConvexError({ code: "AI_BUDGET_EXHAUSTED" });
    await ctx.db.insert("aiReservations", { ...args, status: "reserved" });
  }
});
export const finish = internalMutation({
  args: { requestId: v.string(), actualUsdNano: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("aiReservations").withIndex("by_request", q => q.eq("requestId", args.requestId)).unique();
    if (!row || row.status !== "reserved") return;
    if (args.actualUsdNano !== undefined && !/^(0|[1-9][0-9]*)$/.test(args.actualUsdNano)) throw new ConvexError({ code: "INVALID_AI_COST" });
    await ctx.db.patch(row._id, args.actualUsdNano === undefined ? { status: "unknown" }
      : { status: "confirmed", actualUsdNano: args.actualUsdNano });
  }
});
export const status = internalQuery({
  args: {}, handler: async (ctx) => {
    const rows = await ctx.db.query("aiReservations").collect();
    return { budgetUsdNano: process.env.EMETER_AI_USD_BUDGET_NANO ?? "10000000",
      accountedUsdNano: rows.reduce((sum, row) => sum + BigInt(row.actualUsdNano ?? row.maximumUsdNano), 0n).toString(),
      startedRequests: rows.length, unknownRequests: rows.filter(row => row.status !== "confirmed").length };
  }
});
