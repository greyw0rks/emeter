import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const queue = v.union(v.literal("execution"), v.literal("settlement"));
async function paused(ctx: MutationCtx) {
  return (await ctx.db.query("controls").withIndex("by_key", q => q.eq("key", "runtime")).unique())?.paused ?? false;
}
async function unknownCompletion(ctx: MutationCtx, requestId: string, errorCode: string) {
  const row = await ctx.db.query("records").withIndex("by_key", q => q.eq("model", "aPIRequest").eq("key", requestId)).unique();
  if (!row || !["authorized", "processing"].includes(row.data.requestStatus)) return;
  await ctx.db.patch(row._id, { data: { ...row.data, requestStatus: "indeterminate", reservationActive: true,
    errorCode: ["PROVIDER_RATE_LIMITED", "AI_USAGE_EVIDENCE_INVALID"].includes(errorCode) ? errorCode : "PROVIDER_COMPLETION_UNKNOWN", updatedAt: Date.now() } });
  const epoch = await ctx.db.query("epochs").withIndex("by_model", q => q.eq("model", "aPIRequest")).unique();
  if (epoch) await ctx.db.patch(epoch._id, { revision: epoch.revision + 1 }); else await ctx.db.insert("epochs", { model: "aPIRequest", revision: 1 });
}

export const enqueue = internalMutation({
  args: { key: v.string(), queue, requestId: v.string(), maximumAttempts: v.number() },
  handler: async (ctx, args) => {
    const previous = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (previous) return { key: previous.key };
    const scheduledId = await ctx.scheduler.runAfter(0, internal.runtime.runJob, { key: args.key });
    await ctx.db.insert("jobs", { ...args, status: "waiting", attemptsMade: 0, updatedAt: Date.now(), scheduledId });
    return { key: args.key };
  }
});
export const get = internalQuery({
  args: { key: v.string() }, handler: (ctx, args) => ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique()
});
export const counts = internalQuery({
  args: { queue }, handler: async (ctx, args) => {
    const rows = await ctx.db.query("jobs").collect();
    return Object.fromEntries(["waiting", "active", "completed", "failed"].map(state => [state, rows.filter(row => row.queue === args.queue && row.status === state).length]));
  }
});
export const claim = internalMutation({
  args: { key: v.string(), owner: v.string() },
  handler: async (ctx, args) => {
    if (await paused(ctx)) return null;
    const job = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!job || job.status !== "waiting") return null;
    const running = await ctx.db.query("jobs").withIndex("by_status", q => q.eq("status", "active")).collect();
    if (running.filter(row => row.queue === job.queue && (row.leaseUntil ?? 0) > Date.now()).length >= (job.queue === "execution" ? 2 : 1)) return null;
    await ctx.db.patch(job._id, { status: "active", owner: args.owner, leaseUntil: Date.now() + 180_000,
      attemptsMade: job.attemptsMade + 1, updatedAt: Date.now() });
    return { ...job, owner: args.owner };
  }
});
export const finish = internalMutation({
  args: { key: v.string(), owner: v.string(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!job || job.status !== "active" || job.owner !== args.owner || (job.leaseUntil ?? 0) <= Date.now()) return;
    if (!args.errorCode) { await ctx.db.patch(job._id, { status: "completed", updatedAt: Date.now() }); return; }
    if (job.attemptsMade < job.maximumAttempts) {
      const delay = Math.min(60_000, 1000 * 2 ** (job.attemptsMade - 1));
      const scheduledId = await ctx.scheduler.runAfter(delay, internal.runtime.runJob, { key: job.key });
      await ctx.db.patch(job._id, { status: "waiting", scheduledId, errorCode: args.errorCode, updatedAt: Date.now() });
    } else {
      await ctx.db.patch(job._id, { status: "failed", errorCode: args.errorCode, updatedAt: Date.now() });
      if (job.queue === "execution") await unknownCompletion(ctx, job.requestId, args.errorCode);
    }
  }
});
export const retry = internalMutation({
  args: { key: v.string() }, handler: async (ctx, args) => {
    const job = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!job || job.status !== "failed") return;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.runtime.runJob, { key: job.key });
    await ctx.db.patch(job._id, { status: "waiting", attemptsMade: 0, scheduledId, updatedAt: Date.now() });
  }
});
export const remove = internalMutation({
  args: { key: v.string() }, handler: async (ctx, args) => {
    const job = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!job) return;
    if (job.status === "active" || job.status === "waiting") throw new ConvexError({ code: "JOB_ACTIVE" });
    await ctx.db.delete(job._id);
  }
});
export const repair = internalMutation({
  args: { dispatch: v.optional(v.boolean()) }, handler: async (ctx, args) => {
    const active = await ctx.db.query("jobs").withIndex("by_status", q => q.eq("status", "active")).collect();
    for (const job of active) {
      if ((job.leaseUntil ?? 0) > Date.now()) continue;
      await ctx.db.patch(job._id, { status: "failed", errorCode: "JOB_LEASE_EXPIRED", updatedAt: Date.now() });
      if (job.queue === "execution") await unknownCompletion(ctx, job.requestId, "PROVIDER_COMPLETION_UNKNOWN");
    }
    if (args.dispatch === false || await paused(ctx)) return;
    const waiting = await ctx.db.query("jobs").withIndex("by_status", q => q.eq("status", "waiting")).collect();
    for (const job of waiting) {
      const task = job.scheduledId ? await ctx.db.system.get(job.scheduledId) : null;
      if (task && ["pending", "inProgress"].includes(task.state.kind)) continue;
      const scheduledId = await ctx.scheduler.runAfter(0, internal.runtime.runJob, { key: job.key });
      await ctx.db.patch(job._id, { scheduledId, updatedAt: Date.now() });
    }
  }
});
