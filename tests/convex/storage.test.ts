import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import { createConvexDatabase } from "../../convex/lib/database";
import type { ActionCtx } from "../../convex/_generated/server";

const modules = import.meta.glob("../../convex/**/*.{ts,js}");
const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";
function state() {
  const t = convexTest(schema, modules);
  const ctx = { runQuery: (fn: any, args: any) => t.query(fn, args), runMutation: (fn: any, args: any) => t.mutation(fn, args) } as ActionCtx;
  return { t, db: createConvexDatabase(ctx), ctx };
}
const nonceFor = (id: string) => BigInt("0x" + Buffer.from(id).toString("hex")).toString();
const request = (id: string, amount = "50", nonce = nonceFor(id)) => ({ id, clientId: id, sessionId: "session", customer: "customer", serviceId: "service",
  priceVersion: 1, nonce, requestHash: id, payloadHash: id, wireRequest: {}, authorization: {}, chargeSignature: "signature", amount });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Convex gateway transaction boundaries", () => {
  it("rolls back the whole callback when a later unique write fails", async () => {
    const { db } = state();
    await db.providerExecution.create({ data: { id: "taken", requestHash: "original", status: "processing" } });
    await expect(db.$transaction(async (tx: any) => {
      await tx.user.create({ data: { wallet: "new-wallet" } });
      await tx.providerExecution.create({ data: { id: "taken", requestHash: "other", status: "processing" } });
    })).rejects.toMatchObject({ code: "P2002" });
    expect(await db.user.count()).toBe(0);
    expect((await db.providerExecution.findUnique({ where: { id: "taken" } })).requestHash).toBe("original");
  });
  it("consumes an authentication challenge exactly once under concurrency", async () => {
    const { db } = state();
    await db.authChallenge.create({ data: { id: "challenge", wallet: "wallet", message: "message", expiresAt: new Date(Date.now() + 60_000) } });
    const consume = (hash: string) => db.$transaction(async (tx: any) => {
      const used = await tx.authChallenge.updateMany({ where: { id: "challenge", consumedAt: null }, data: { consumedAt: new Date() } });
      if (used.count !== 1) throw new Error("CONSUMED");
      await tx.authSession.create({ data: { tokenHash: hash, wallet: "wallet", expiresAt: new Date(Date.now() + 60_000) } });
    });
    const results = await Promise.allSettled([consume("hash-a"), consume("hash-b")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.authSession.count()).toBe(1);
  });
  it("serializes budget reservation and reads the balance after acquiring the lease", async () => {
    const { db } = state();
    let balance = 100n, reads = 0;
    const reserve = (id: string) => db.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(lockSql, "session");
      reads++;
      const currentBalance = balance;
      const total = await tx.aPIRequest.aggregate({ where: { sessionId: "session", reservationActive: true }, _sum: { amount: true } });
      const reserved = BigInt(total._sum.amount?.toFixed(0) ?? "0");
      if (reserved + 75n > currentBalance) throw new Error("BUDGET_RESERVED");
      return tx.aPIRequest.create({ data: request(id, "75") });
    });
    const result = await Promise.allSettled([reserve("one"), reserve("two")]);
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(reads).toBeGreaterThanOrEqual(2);
    const row = (await db.aPIRequest.findMany())[0];
    await db.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(lockSql, "session");
      balance = 25n;
      await tx.aPIRequest.update({ where: { id: row.id }, data: { reservationActive: false, paymentStatus: "settled" } });
    });
    await expect(reserve("after-settlement")).rejects.toThrow("BUDGET_RESERVED");
  });
  it("retries a snapshot after a phantom reservation changes its table epoch", async () => {
    const { db } = state();
    let release!: () => void, scanned!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { scanned = resolve; });
    let calls = 0;
    const pending = db.$transaction(async (tx: any) => {
      const sums = await tx.aPIRequest.aggregate({ where: { sessionId: "session" }, _sum: { amount: true } });
      if (++calls === 1) { scanned(); await gate; }
      if (BigInt(sums._sum.amount?.toFixed(0) ?? "0") + 50n > 100n) throw new Error("BUDGET_RESERVED");
      return tx.aPIRequest.create({ data: request("pending", "50") });
    });
    await ready;
    await db.aPIRequest.create({ data: request("raced", "75") });
    release();
    await expect(pending).rejects.toThrow("BUDGET_RESERVED");
    expect(calls).toBe(2);
    expect(await db.aPIRequest.count()).toBe(1);
  });
  it("preserves exact integer amounts and nonce uniqueness beyond safe JS numbers", async () => {
    const { db } = state();
    const amount = "340282366920938463463374607431768211457";
    await db.aPIRequest.create({ data: request("first", amount, "999999999999999999999999") });
    await db.aPIRequest.create({ data: request("second", "3") });
    const totals = await db.aPIRequest.aggregate({ _sum: { amount: true }, _count: true });
    expect(totals._sum.amount.toFixed(0)).toBe((BigInt(amount) + 3n).toString());
    await expect(db.aPIRequest.create({ data: request("collision", "1", "999999999999999999999999") })).rejects.toMatchObject({ code: "P2002" });
  });
  it("reads paginated records without truncating totals", async () => {
    const { db } = state();
    for (let i = 0; i < 70; i++) await db.aPIRequest.create({ data: request("request-" + i, "3", String(i)) });
    expect(await db.aPIRequest.count()).toBe(70);
    expect((await db.aPIRequest.aggregate({ _sum: { amount: true } }))._sum.amount.toFixed(0)).toBe("210");
  });
  it("deletes indexed projections by partial predicates while preserving signed evidence", async () => {
    const { db } = state();
    await db.chainEvent.create({ data: { chainId: 196, transactionHash: "hash", logIndex: 0, blockNumber: 10n, blockHash: "block", contract: "vault", eventName: "event", arguments: {} } });
    await db.usageReceipt.create({ data: { requestId: "request", envelope: { sig: "signature" }, digest: "digest", bodyHash: "body", signer: "provider", providerVerified: true } });
    await db.settlementAttempt.create({ data: { id: "attempt", requestId: "request", evidence: {}, status: "mined", rawTransaction: "original-bytes", transactionHash: "original-hash" } });
    await db.$transaction(async (tx: any) => { await tx.chainEvent.deleteMany({ where: { chainId: 196 } }); await tx.spendingSession.deleteMany(); });
    expect(await db.chainEvent.count()).toBe(0);
    expect((await db.usageReceipt.findUnique({ where: { requestId: "request" } })).envelope.sig).toBe("signature");
    expect((await db.settlementAttempt.findUnique({ where: { id: "attempt" } })).rawTransaction).toBe("original-bytes");
  });
  it("rejects an expired lease and cannot release its new owner's lock", async () => {
    vi.useFakeTimers();
    const { t, db } = state();
    await t.mutation(internal.store.acquire, { resource: "session", owner: "old", ttl: 1000 });
    vi.advanceTimersByTime(1500);
    await t.mutation(internal.store.acquire, { resource: "session", owner: "new", ttl: 1000 });
    await expect(t.mutation(internal.store.commit, { epochs: [], leases: [{ resource: "session", owner: "old" }],
      operations: [{ model: "user", key: "late", kind: "create", data: { wallet: "late" } }] })).rejects.toMatchObject({ data: { code: "TRANSACTION_LEASE_EXPIRED" } });
    await t.mutation(internal.store.release, { resource: "session", owner: "old" });
    await expect(t.mutation(internal.store.acquire, { resource: "session", owner: "third", ttl: 1000 })).rejects.toMatchObject({ data: { code: "RESOURCE_LOCK_BUSY" } });
    expect(await db.user.count()).toBe(0);
  });
});

describe("Durable scheduled jobs", () => {
  it("deduplicates a stable job id and enforces the existing worker concurrency", async () => {
    vi.useFakeTimers();
    const { t } = state();
    for (const key of ["one", "one", "two", "three"]) await t.mutation(internal.queue.enqueue, { key, queue: "execution", requestId: key, maximumAttempts: 4 });
    expect((await t.query(internal.queue.counts, { queue: "execution" })).waiting).toBe(3);
    expect(await t.mutation(internal.queue.claim, { key: "one", owner: "first" })).not.toBeNull();
    expect(await t.mutation(internal.queue.claim, { key: "two", owner: "second" })).not.toBeNull();
    expect(await t.mutation(internal.queue.claim, { key: "three", owner: "third" })).toBeNull();
    await t.mutation(internal.queue.finish, { key: "one", owner: "first" });
    expect(await t.mutation(internal.queue.claim, { key: "three", owner: "third" })).not.toBeNull();
  });
  it("retains reservations and fences late writes when an action dies", async () => {
    vi.useFakeTimers();
    const { t, db } = state();
    await db.aPIRequest.create({ data: request("request") });
    await t.mutation(internal.queue.enqueue, { key: "job", queue: "execution", requestId: "request", maximumAttempts: 4 });
    await t.mutation(internal.queue.claim, { key: "job", owner: "stopped" });
    vi.advanceTimersByTime(181_000);
    await t.mutation(internal.queue.repair, { dispatch: false });
    const row = await db.aPIRequest.findUnique({ where: { id: "request" } });
    expect(row.requestStatus).toBe("indeterminate"); expect(row.reservationActive).toBe(true); expect(row.nonce.toFixed(0)).toBe(nonceFor("request"));
    await expect(t.mutation(internal.store.commit, { epochs: [], leases: [], fence: { key: "job", owner: "stopped" }, operations: [] })).rejects.toMatchObject({ data: { code: "JOB_LEASE_EXPIRED" } });
  });
  it("preserves prepared transaction bytes when a settlement job is retried", async () => {
    vi.useFakeTimers();
    const { t, db } = state();
    await db.settlementAttempt.create({ data: { id: "attempt", requestId: "request", evidence: {}, status: "prepared", nonce: 7n,
      rawTransaction: "original-bytes", transactionHash: "original-hash", maximumGasCost: "123" } });
    await t.mutation(internal.queue.enqueue, { key: "settle", queue: "settlement", requestId: "request", maximumAttempts: 1 });
    await t.mutation(internal.queue.claim, { key: "settle", owner: "worker" });
    await t.mutation(internal.queue.finish, { key: "settle", owner: "worker", errorCode: "BROADCAST_TIMEOUT" });
    await t.mutation(internal.queue.retry, { key: "settle" });
    const attempt = await db.settlementAttempt.findUnique({ where: { id: "attempt" } });
    expect(attempt.rawTransaction).toBe("original-bytes"); expect(attempt.transactionHash).toBe("original-hash"); expect(attempt.nonce).toBe(7n);
  });
});
