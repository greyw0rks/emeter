"use node";

import { randomUUID } from "node:crypto";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { aggregate, bigintFields, creation, dateFields, decimalFields, models, primaryKey, selectRows, update } from "./models";
import type { Model, Query, Row } from "./models";

export type JobFence = { key: string; owner: string };
type Operation = { model: Model; key: string; kind: "create" | "put" | "delete"; data?: Row };
export class StorageError extends Error { constructor(public code: string) { super(code); } }
export function errorCode(error: unknown): string | undefined {
  if (error instanceof StorageError) return error.code;
  const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
  if (data && typeof data === "object" && "code" in data && typeof data.code === "string") return data.code;
  return undefined;
}
class ExactAmount {
  private readonly value: bigint;
  constructor(value: string) { this.value = BigInt(value); }
  toFixed(digits: number) { if (digits !== 0) throw new Error("INTEGER_AMOUNT_REQUIRED"); return this.value.toString(); }
  toString() { return this.value.toString(); }
  toJSON() { return this.value.toString(); }
}
export function serialize(value: any): any {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint" || value instanceof ExactAmount) return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([,item]) => item !== undefined).map(([key,item]) => [key,serialize(item)]));
  return value;
}
function restore(model: Model, input: Row): Row {
  const row = { ...input };
  for (const field of decimalFields[model] ?? []) if (row[field] !== null && row[field] !== undefined) row[field] = new ExactAmount(row[field]);
  for (const field of bigintFields[model] ?? []) if (row[field] !== null && row[field] !== undefined) row[field] = BigInt(row[field]);
  for (const field of dateFields[model] ?? []) if (row[field] !== null && row[field] !== undefined) row[field] = new Date(row[field]);
  return row;
}
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

class Transaction {
  readonly owner = randomUUID();
  readonly epochs = new Map<Model, number>();
  readonly leases = new Set<string>();
  readonly operations = new Map<string, Operation>();
  readonly deadline: number;
  constructor(readonly ctx: ActionCtx, readonly fence: JobFence | undefined, timeout: number) { this.deadline = Date.now() + timeout; }
  assertOpen() { if (Date.now() >= this.deadline) throw new StorageError("TRANSACTION_LEASE_EXPIRED"); }
  async read(model: Model, query: Query, mode = "findMany") {
    this.assertOpen();
    let cursor: string | null = null, revision: number | undefined;
    const rows = new Map<string, Row>();
    do {
      this.assertOpen();
      const page: { revision: number; done: boolean; cursor: string; rows: { key: string; data: Row }[] } =
        await this.ctx.runQuery(internal.store.read, { model, query: serialize(query), mode, cursor });
      if (revision !== undefined && revision !== page.revision) throw new StorageError("TRANSACTION_CONFLICT");
      revision = page.revision;
      for (const item of page.rows) rows.set(item.key, item.data);
      cursor = page.done ? null : page.cursor;
    } while (cursor !== null);
    const expected = this.epochs.get(model);
    if (expected !== undefined && expected !== revision) throw new StorageError("TRANSACTION_CONFLICT");
    this.epochs.set(model, revision ?? 0);
    for (const operation of this.operations.values()) {
      if (operation.model !== model) continue;
      if (operation.kind === "delete") rows.delete(operation.key); else rows.set(operation.key, operation.data!);
    }
    return selectRows(model, [...rows.values()], serialize(query));
  }
  write(operation: Operation) {
    this.assertOpen();
    const key = operation.model + ":" + operation.key;
    const previous = this.operations.get(key);
    this.operations.set(key, { ...operation, kind: previous?.kind === "create" && operation.kind === "put" ? "create" : operation.kind });
  }
  async acquire(resource: string) {
    while (true) {
      this.assertOpen();
      try {
        await this.ctx.runMutation(internal.store.acquire, { resource, owner: this.owner, ttl: this.deadline - Date.now() + 1000 });
        this.leases.add(resource); return;
      } catch (error) { if (errorCode(error) !== "RESOURCE_LOCK_BUSY") throw error; await pause(50); }
    }
  }
  async finish() {
    this.assertOpen();
    await this.ctx.runMutation(internal.store.commit, {
      epochs: [...this.epochs].map(([model, revision]) => ({ model, revision })),
      leases: [...this.leases].map(resource => ({ resource, owner: this.owner })),
      ...(this.fence ? { fence: this.fence } : {}), operations: [...this.operations.values()]
    });
  }
  async release() {
    for (const resource of this.leases) await this.ctx.runMutation(internal.store.release, { resource, owner: this.owner }).catch(() => undefined);
  }
}

/** Adapter keeps the reviewed gateway's protocol logic. A callback's writes are
 * buffered, epoch-checked, and atomically committed; it cannot broadcast. */
export function createConvexDatabase(ctx: ActionCtx, fence?: JobFence) {
  const transaction = async <T>(callback: (db: any) => Promise<T>, options: { timeout?: number } = {}): Promise<T> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = new Transaction(ctx, fence, options.timeout ?? 20_000);
      try {
        const result = await callback(database(tx));
        await tx.finish();
        return result;
      } catch (error) {
        const code = errorCode(error);
        if (code !== "TRANSACTION_CONFLICT" || attempt === 4) throw code ? new StorageError(code) : error;
      } finally { await tx.release(); }
      await pause(10 * (attempt + 1));
    }
    throw new StorageError("TRANSACTION_CONFLICT");
  };
  const query = async (model: Model, args: Query, mode: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await new Transaction(ctx, fence, 30_000).read(model, args, mode); }
      catch (error) { if (errorCode(error) !== "TRANSACTION_CONFLICT" || attempt === 4) throw error; }
    }
    throw new StorageError("TRANSACTION_CONFLICT");
  };
  const database = (tx?: Transaction): any => {
    const db: any = { $disconnect: async () => undefined, $transaction: transaction,
      $executeRawUnsafe: async (sql: string, resource: string) => {
        if (!tx || sql !== "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))") throw new StorageError("UNSUPPORTED_STORAGE_OPERATION");
        await tx.acquire(resource); return 1;
      } };
    for (const model of models) {
      const read = (args: Query = {}, mode = "findMany") => tx ? tx.read(model, args, mode) : query(model, args, mode);
      const find = async (args: Query = {}) => (await read({ ...args, take: 1 }))[0] ?? null;
      db[model] = {
        findUnique: async (args: Query) => { const row = await find(args); return row ? restore(model, row) : null; },
        findFirst: async (args: Query = {}) => { const row = await find(args); return row ? restore(model, row) : null; },
        findUniqueOrThrow: async (args: Query) => { const row = await find(args); if (!row) throw new StorageError("P2025"); return restore(model, row); },
        findMany: async (args: Query = {}) => (await read(args)).map(row => restore(model, row)),
        count: async (args: Query = {}) => (await read(args, "count")).length,
        aggregate: async (args: Query) => {
          const result = aggregate(await read(args, "aggregate"), args);
          return { ...result, _sum: Object.fromEntries(Object.entries(result._sum).map(([key,value]) => [key, value === null ? null : new ExactAmount(value)])) };
        },
        groupBy: async (args: Query) => {
          const groups = new Map<string, Row[]>();
          for (const row of await read(args, "groupBy")) {
            const key = JSON.stringify(args.by!.map(field => row[field]));
            groups.set(key, [...(groups.get(key) ?? []), row]);
          }
          return [...groups.values()].map(rows => ({ ...Object.fromEntries(args.by!.map(field => [field, rows[0]![field]])),
            _sum: Object.fromEntries(Object.entries(aggregate(rows, args)._sum).map(([field,value]) => [field, value === null ? null : new ExactAmount(value)])) }));
        },
        create: async (args: { data: Row }) => {
          const data = creation(model, serialize(args.data), Date.now(), randomUUID());
          const operation: Operation = { model, key: primaryKey(model, data), kind: "create", data };
          if (tx) tx.write(operation); else {
            try { await ctx.runMutation(internal.store.commit, { epochs: [], leases: [], operations: [operation], ...(fence ? { fence } : {}) }); }
            catch (error) { const code = errorCode(error); throw code ? new StorageError(code) : error; }
          }
          return restore(model, data);
        },
        update: async (args: { where: Row; data: Row }) => {
          if (!tx) return transaction(inner => inner[model].update(args));
          const row = await find({ where: args.where }); if (!row) throw new StorageError("P2025");
          const data = { ...row, ...update(model, serialize(args.data), Date.now()) };
          tx.write({ model, key: primaryKey(model, data), kind: "put", data }); return restore(model, data);
        },
        updateMany: async (args: { where?: Row; data: Row }) => {
          if (!tx) return transaction(inner => inner[model].updateMany(args));
          const rows = await read({ where: args.where ?? {} });
          for (const row of rows) { const data = { ...row, ...update(model, serialize(args.data), Date.now()) }; tx.write({ model, key: primaryKey(model, data), kind: "put", data }); }
          return { count: rows.length };
        },
        upsert: async (args: { where: Row; create: Row; update: Row }) => {
          if (!tx) return transaction(inner => inner[model].upsert(args));
          return await find({ where: args.where }) ? db[model].update({ where: args.where, data: args.update }) : db[model].create({ data: args.create });
        },
        deleteMany: async (args: Query = {}) => {
          if (!tx) return transaction(inner => inner[model].deleteMany(args));
          const rows = await read(args);
          for (const row of rows) tx.write({ model, key: primaryKey(model, row), kind: "delete" });
          return { count: rows.length };
        }
      };
    }
    return db;
  };
  return database();
}
