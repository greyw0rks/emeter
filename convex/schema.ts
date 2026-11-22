import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  records: defineTable({
    model: v.string(), key: v.string(), data: v.any(),
    wallet: v.optional(v.string()), sessionId: v.optional(v.string()),
    serviceId: v.optional(v.string()), requestId: v.optional(v.string()),
    credentialHash: v.optional(v.string()), nonceKey: v.optional(v.string()),
    transactionHash: v.optional(v.string())
  }).index("by_model", ["model"]).index("by_key", ["model", "key"])
    .index("by_wallet", ["model", "wallet"]).index("by_session", ["model", "sessionId"])
    .index("by_service", ["model", "serviceId"]).index("by_request", ["model", "requestId"])
    .index("by_credential", ["model", "credentialHash"]).index("by_nonce", ["model", "nonceKey"])
    .index("by_transaction", ["model", "transactionHash"]),
  epochs: defineTable({ model: v.string(), revision: v.number() }).index("by_model", ["model"]),
  locks: defineTable({ resource: v.string(), owner: v.string(), expiresAt: v.number() }).index("by_resource", ["resource"]),
  jobs: defineTable({
    key: v.string(), queue: v.union(v.literal("execution"), v.literal("settlement")), requestId: v.string(),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("completed"), v.literal("failed")),
    attemptsMade: v.number(), maximumAttempts: v.number(), owner: v.optional(v.string()),
    leaseUntil: v.optional(v.number()), scheduledId: v.optional(v.id("_scheduled_functions")),
    errorCode: v.optional(v.string()), updatedAt: v.number()
  }).index("by_key", ["key"]).index("by_status", ["status"]),
  controls: defineTable({ key: v.string(), paused: v.boolean() }).index("by_key", ["key"]),
  aiReservations: defineTable({ requestId: v.string(), maximumUsdNano: v.string(), actualUsdNano: v.optional(v.string()),
    status: v.union(v.literal("reserved"), v.literal("confirmed"), v.literal("unknown")) }).index("by_request", ["requestId"])
});
