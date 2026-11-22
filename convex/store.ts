import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { indexes, keyFromWhere, matches, models, primaryKey, projectedFields } from "./lib/models";
import type { Model, Query, Row } from "./lib/models";

function checkedModel(value: string): Model {
  if (!(models as readonly string[]).includes(value)) throw new ConvexError({ code: "UNKNOWN_STORAGE_MODEL" });
  return value as Model;
}
const fence = v.object({ key: v.string(), owner: v.string() });

/** Every page reports the table epoch. Actions reject a mixed-version read. */
export const read = internalQuery({
  args: { model: v.string(), query: v.any(), mode: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const model = checkedModel(args.model), query = args.query as Query, where = query.where ?? {};
    const key = keyFromWhere(model, where);
    let source;
    if (key) source = ctx.db.query("records").withIndex("by_key", q => q.eq("model", model).eq("key", key));
    else if (where.sessionId_nonce) source = ctx.db.query("records").withIndex("by_nonce", q => q.eq("model", model)
      .eq("nonceKey", where.sessionId_nonce.sessionId + ":" + where.sessionId_nonce.nonce));
    else if (typeof (where.keyHash ?? where.tokenHash) === "string") source = ctx.db.query("records").withIndex("by_credential", q => q.eq("model", model).eq("credentialHash", where.keyHash ?? where.tokenHash));
    else if (typeof where.sessionId === "string") source = ctx.db.query("records").withIndex("by_session", q => q.eq("model", model).eq("sessionId", where.sessionId));
    else if (typeof where.requestId === "string") source = ctx.db.query("records").withIndex("by_request", q => q.eq("model", model).eq("requestId", where.requestId));
    else if (typeof (where.wallet ?? where.customer ?? where.provider) === "string") source = ctx.db.query("records").withIndex("by_wallet", q => q.eq("model", model).eq("wallet", where.wallet ?? where.customer ?? where.provider));
    else if (typeof where.serviceId === "string") source = ctx.db.query("records").withIndex("by_service", q => q.eq("model", model).eq("serviceId", where.serviceId));
    else source = ctx.db.query("records").withIndex("by_model", q => q.eq("model", model));
    const page = await source.paginate({ cursor: args.cursor, numItems: 64 });
    const epoch = await ctx.db.query("epochs").withIndex("by_model", q => q.eq("model", model)).unique();
    const fields = projectedFields(model, query, args.mode);
    return { revision: epoch?.revision ?? 0, done: page.isDone, cursor: page.continueCursor,
      rows: page.page.filter(record => matches(model, record.data, where)).map(record => ({ key: record.key,
        data: fields ? Object.fromEntries(Object.entries(record.data).filter(([field]) => fields.has(field))) : record.data })) };
  }
});

/** Callback transactions commit as one Convex mutation. Table epochs detect
 * phantoms; fenced leases cover chain reads and signing between mutations. */
export const commit = internalMutation({
  args: {
    epochs: v.array(v.object({ model: v.string(), revision: v.number() })),
    leases: v.array(v.object({ resource: v.string(), owner: v.string() })),
    fence: v.optional(fence),
    operations: v.array(v.object({ model: v.string(), key: v.string(), kind: v.union(v.literal("create"), v.literal("put"), v.literal("delete")), data: v.optional(v.any()) }))
  },
  handler: async (ctx, args) => {
    if (args.fence) {
      const job = await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.fence!.key)).unique();
      if (!job || job.status !== "active" || job.owner !== args.fence.owner || (job.leaseUntil ?? 0) <= Date.now())
        throw new ConvexError({ code: "JOB_LEASE_EXPIRED" });
    }
    for (const expected of args.epochs) {
      checkedModel(expected.model);
      const epoch = await ctx.db.query("epochs").withIndex("by_model", q => q.eq("model", expected.model)).unique();
      if ((epoch?.revision ?? 0) !== expected.revision) throw new ConvexError({ code: "TRANSACTION_CONFLICT" });
    }
    for (const expected of args.leases) {
      const lock = await ctx.db.query("locks").withIndex("by_resource", q => q.eq("resource", expected.resource)).unique();
      if (!lock || lock.owner !== expected.owner || lock.expiresAt <= Date.now()) throw new ConvexError({ code: "TRANSACTION_LEASE_EXPIRED" });
    }
    const changed = new Set<string>();
    for (const operation of args.operations) {
      const model = checkedModel(operation.model);
      const previous = await ctx.db.query("records").withIndex("by_key", q => q.eq("model", model).eq("key", operation.key)).unique();
      if (operation.kind === "delete") { if (previous) { await ctx.db.delete(previous._id); changed.add(model); } continue; }
      const data = operation.data as Row;
      if (!data || primaryKey(model, data) !== operation.key) throw new ConvexError({ code: "INVALID_RECORD_KEY" });
      if (operation.kind === "create" && previous) throw new ConvexError({ code: "P2002" });
      const metadata = indexes(model, data);
      const collision = model === "aPIRequest"
        ? await ctx.db.query("records").withIndex("by_nonce", q => q.eq("model", model).eq("nonceKey", metadata.nonceKey)).unique()
        : model === "aPIKey"
          ? await ctx.db.query("records").withIndex("by_credential", q => q.eq("model", model).eq("credentialHash", metadata.credentialHash)).unique()
          : model === "settlementAttempt" && metadata.transactionHash
            ? await ctx.db.query("records").withIndex("by_transaction", q => q.eq("model", model).eq("transactionHash", metadata.transactionHash)).unique() : null;
      if (collision && collision.key !== operation.key) throw new ConvexError({ code: "P2002" });
      const record = { model, key: operation.key, data, ...metadata };
      if (previous) await ctx.db.replace(previous._id, record); else await ctx.db.insert("records", record);
      changed.add(model);
    }
    for (const model of changed) {
      const epoch = await ctx.db.query("epochs").withIndex("by_model", q => q.eq("model", model)).unique();
      if (epoch) await ctx.db.patch(epoch._id, { revision: epoch.revision + 1 }); else await ctx.db.insert("epochs", { model, revision: 1 });
    }
    return { committed: true };
  }
});

export const acquire = internalMutation({
  args: { resource: v.string(), owner: v.string(), ttl: v.number() },
  handler: async (ctx, args) => {
    const lock = await ctx.db.query("locks").withIndex("by_resource", q => q.eq("resource", args.resource)).unique();
    if (lock && lock.owner !== args.owner && lock.expiresAt > Date.now()) throw new ConvexError({ code: "RESOURCE_LOCK_BUSY" });
    const data = { resource: args.resource, owner: args.owner, expiresAt: Date.now() + Math.max(1000, Math.min(30_000, args.ttl)) };
    if (lock) await ctx.db.replace(lock._id, data); else await ctx.db.insert("locks", data);
    return { expiresAt: data.expiresAt };
  }
});
export const release = internalMutation({
  args: { resource: v.string(), owner: v.string() },
  handler: async (ctx, args) => {
    const lock = await ctx.db.query("locks").withIndex("by_resource", q => q.eq("resource", args.resource)).unique();
    if (lock?.owner === args.owner) await ctx.db.delete(lock._id);
  }
});
export const control = internalQuery({
  args: { fence: v.optional(fence) },
  handler: async (ctx, args) => {
    const control = await ctx.db.query("controls").withIndex("by_key", q => q.eq("key", "runtime")).unique();
    const job = args.fence ? await ctx.db.query("jobs").withIndex("by_key", q => q.eq("key", args.fence!.key)).unique() : null;
    return { paused: control?.paused ?? false, validJob: !args.fence || Boolean(job && job.status === "active" && job.owner === args.fence.owner && (job.leaseUntil ?? 0) > Date.now()) };
  }
});
export const pause = internalMutation({
  args: { paused: v.boolean() },
  handler: async (ctx, args) => {
    const previous = await ctx.db.query("controls").withIndex("by_key", q => q.eq("key", "runtime")).unique();
    if (previous) await ctx.db.patch(previous._id, { paused: args.paused }); else await ctx.db.insert("controls", { key: "runtime", paused: args.paused });
  }
});
