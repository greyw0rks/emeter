import { LEGACY_DEPLOYMENT } from "@emeter/shared";

/** Storage vocabulary for the existing gateway. Monetary columns remain exact strings. */
export const models = ["user", "authChallenge", "authSession", "service", "priceVersion", "spendingSession",
  "aPIRequest", "usageReceipt", "providerExecution", "settlementAttempt", "settlement", "chainEvent",
  "indexerCursor", "aPIKey", "workerHeartbeat"] as const;
export type Model = typeof models[number];
export type Row = Record<string, any>;
export type Query = { where?: Row; select?: Row; orderBy?: Row; take?: number; skip?: number; _sum?: Row; _count?: boolean; by?: string[] };

export const decimalFields: Partial<Record<Model, string[]>> = {
  priceVersion: ["price"], spendingSession: ["budget", "softLimit", "maxCharge"],
  aPIRequest: ["amount", "nonce"], settlementAttempt: ["maximumGasCost", "actualGasCost"], settlement: ["amount"]
};
export const bigintFields: Partial<Record<Model, string[]>> = {
  spendingSession: ["expiresAt", "refundAfter", "indexedBlock"], settlementAttempt: ["nonce"],
  settlement: ["blockNumber"], chainEvent: ["blockNumber"], indexerCursor: ["blockNumber"]
};
export const dateFields: Partial<Record<Model, string[]>> = {
  user: ["createdAt"], authChallenge: ["expiresAt", "consumedAt"], authSession: ["expiresAt", "revokedAt"],
  service: ["verifiedAt", "createdAt"], aPIRequest: ["createdAt", "updatedAt"], usageReceipt: ["createdAt"],
  providerExecution: ["createdAt", "updatedAt"], settlementAttempt: ["createdAt", "updatedAt"],
  indexerCursor: ["updatedAt"], aPIKey: ["expiresAt", "revokedAt", "createdAt"], workerHeartbeat: ["updatedAt"]
};
const created = new Set<Model>(["user", "service", "aPIRequest", "usageReceipt", "providerExecution", "settlementAttempt", "aPIKey"]);
const updated = new Set<Model>(["aPIRequest", "providerExecution", "settlementAttempt", "indexerCursor", "workerHeartbeat"]);
const defaults: Partial<Record<Model, Row>> = {
  authChallenge: { consumedAt: null }, authSession: { revokedAt: null }, service: { active: true, verifiedAt: null },
  aPIKey: { sessionId: null, serviceId: null, expiresAt: null, revokedAt: null },
  aPIRequest: { reservationActive: true, requestStatus: "authorized", paymentStatus: "unsubmitted", chargeAuthorized: false,
    customerOverride: null, policyInputs: null, result: null, errorCode: null },
  usageReceipt: { reportedUsage: null, aiReceipt: null, delivery: "reported", customerAcceptance: "not_requested" },
  providerExecution: { envelope: null, aiReceipt: null, upstreamResponse: null },
  settlementAttempt: { transactionHash: null, rawTransaction: null, nonce: null, maximumGasCost: null, actualGasCost: null, errorCode: null }
};
export function creation(model: Model, data: Row, now: number, id: string): Row {
  return { ...defaults[model], ...(created.has(model) ? { createdAt: now } : {}), ...(updated.has(model) ? { updatedAt: now } : {}),
    ...(["aPIKey", "settlementAttempt"].includes(model) ? { id } : {}), ...data };
}
export function update(model: Model, data: Row, now: number): Row {
  return { ...data, ...(updated.has(model) ? { updatedAt: now } : {}) };
}
export function primaryKey(model: Model, data: Row): string {
  if (model === "priceVersion") {
    if (typeof data.serviceId !== "string" || !Number.isInteger(data.version)) throw new Error("INVALID_RECORD_KEY");
    return data.serviceId + ":" + data.version;
  }
  if (model === "chainEvent") {
    if (!Number.isInteger(data.chainId) || typeof data.transactionHash !== "string" || !Number.isInteger(data.logIndex)) throw new Error("INVALID_RECORD_KEY");
    return data.chainId + ":" + data.transactionHash + ":" + data.logIndex;
  }
  const field = model === "user" ? "wallet" : model === "authSession" ? "tokenHash"
    : ["usageReceipt", "settlement"].includes(model) ? "requestId" : "id";
  if (typeof data[field] !== "string" || !data[field]) throw new Error("INVALID_RECORD_KEY");
  return data[field];
}
export function keyFromWhere(model: Model, where: Row = {}): string | undefined {
  if (model === "priceVersion" && where.serviceId_version) return primaryKey(model, where.serviceId_version);
  if (model === "chainEvent" && where.chainId_transactionHash_logIndex) return primaryKey(model, where.chainId_transactionHash_logIndex);
  try { return primaryKey(model, where); } catch { return undefined; }
}
export function indexes(model: Model, data: Row) {
  const values = { wallet: data.wallet ?? data.customer ?? data.provider, sessionId: data.sessionId,
    serviceId: data.serviceId, requestId: data.requestId, credentialHash: data.keyHash ?? data.tokenHash,
    nonceKey: model === "aPIRequest" ? data.sessionId + ":" + data.nonce : undefined, transactionHash: data.transactionHash };
  return Object.fromEntries(Object.entries(values).filter(([,value]) => typeof value === "string"));
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function ordered(model: Model, field: string, a: any, b: any) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (decimalFields[model]?.includes(field) || bigintFields[model]?.includes(field)) { a = BigInt(a); b = BigInt(b); }
  return a < b ? -1 : a > b ? 1 : 0;
}
export function matches(model: Model, row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "OR") return condition.some((part: Row) => matches(model, row, part));
    if (field === "AND") return condition.every((part: Row) => matches(model, row, part));
    if (field === "serviceId_version" || field === "chainId_transactionHash_logIndex" || field === "sessionId_nonce")
      return matches(model, row, condition);
    const actual = row[field] ?? (["aPIRequest", "spendingSession"].includes(model) && field === "vault" ? LEGACY_DEPLOYMENT.vault.toLowerCase()
      : ["aPIRequest", "spendingSession"].includes(model) && field === "token" ? LEGACY_DEPLOYMENT.token.toLowerCase() : row[field]);
    if (condition === null || typeof condition !== "object" || Array.isArray(condition)) return equal(actual, condition);
    if (condition.path) {
      const nested = condition.path.reduce((value: any, key: string) => value?.[key], actual);
      return equal(nested, condition.equals);
    }
    return Object.entries(condition).every(([operation, expected]) => {
      if (operation === "not") return !equal(actual, expected);
      if (operation === "in") return (expected as unknown[]).some(value => equal(actual, value));
      if (operation === "equals") return equal(actual, expected);
      const order = ordered(model, field, actual, expected);
      if (operation === "gt") return order > 0;
      if (operation === "gte") return order >= 0;
      if (operation === "lt") return order < 0;
      if (operation === "lte") return order <= 0;
      throw new Error("UNSUPPORTED_STORAGE_FILTER");
    });
  });
}
export function selectRows(model: Model, input: Row[], query: Query = {}) {
  let rows = input.filter(row => matches(model, row, query.where));
  if (query.orderBy) rows.sort((a,b) => {
    for (const [field, direction] of Object.entries(query.orderBy!)) {
      const order = ordered(model, field, a[field], b[field]);
      if (order) return direction === "desc" ? -order : order;
    }
    return 0;
  });
  rows = rows.slice(query.skip ?? 0, query.take === undefined ? undefined : (query.skip ?? 0) + query.take);
  if (query.select) return rows.map(row => Object.fromEntries(Object.keys(query.select!).filter(field => query.select![field]).map(field => [field, row[field]])));
  return rows;
}
export function aggregate(rows: Row[], query: Query) {
  const sum = Object.fromEntries(Object.keys(query._sum ?? {}).map(field => [field,
    rows.length ? rows.reduce((total, row) => total + BigInt(row[field] ?? "0"), 0n).toString() : null]));
  return { _sum: sum, ...(query._count ? { _count: rows.length } : {}) };
}
export function projectedFields(model: Model, query: Query, mode: string): Set<string> | undefined {
  if (!query.select && mode !== "aggregate" && mode !== "count" && mode !== "groupBy") return;
  const fields = new Set<string>(["id", "wallet", "tokenHash", "requestId", "serviceId", "version", "chainId", "transactionHash", "logIndex"]);
  for (const field of Object.keys(query.select ?? query._sum ?? {})) fields.add(field);
  for (const field of query.by ?? []) fields.add(field);
  for (const field of Object.keys(query.orderBy ?? {})) fields.add(field);
  const visit = (where: Row) => Object.entries(where).forEach(([field,value]) => {
    if (field === "OR" || field === "AND") value.forEach(visit);
    else if (field.endsWith("_version") || field.endsWith("_logIndex") || field === "sessionId_nonce") visit(value);
    else fields.add(field);
  });
  visit(query.where ?? {});
  return fields;
}
