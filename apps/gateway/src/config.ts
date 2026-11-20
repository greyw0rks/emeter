import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";
import type { Address } from "viem";
import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";

export type GatewayConfig = {
  databaseUrl: string; redisUrl: string; rpcUrl: string; chainId: 196;
  vault: Address; registry: Address; token: Address; adapter: Address;
  deployer: Address; providerSigner: Address; container: Address;
  deploymentBlock: bigint; gatewayOrigin: string; providerOrigin: string;
  allowedProviderOrigins: string[]; dispatchSecret: string; confirmations: number;
  queuePrefix: string; settlementGasBudget: bigint; executionTimeoutMs: number;
  networkMode: "mainnet" | "local-fork";
};

export async function loadRuntimeEnvironment() {
  if (!process.env.EMETER_RUNTIME_ENV) return;
  const path = await realpath(process.env.EMETER_RUNTIME_ENV);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  if (path === root.slice(0, -1) || path.startsWith(root)) throw new Error("Runtime credentials must remain outside the repository");
  process.loadEnvFile(path);
}

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid gateway configuration: " + name);
  return value;
}

function origin(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Invalid configured origin");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Public origins require HTTPS");
  return url.origin;
}

export async function loadGatewayConfig(): Promise<GatewayConfig> {
  await loadRuntimeEnvironment();
  const original = JSON.parse(await readFile(new URL("../../../deployments/xlayer-196.json", import.meta.url), "utf8"));
  const engine = JSON.parse(await readFile(new URL("../../../deployments/xlayer-196-engine.json", import.meta.url), "utf8"));
  for (const name of ["DATABASE_URL", "REDIS_URL", "EMETER_PROVIDER_DISPATCH_SECRET"])
    if (!process.env[name]) throw new Error("Missing gateway configuration: " + name);
  const dispatchSecret = process.env.EMETER_PROVIDER_DISPATCH_SECRET!;
  if (dispatchSecret.length < 32) throw new Error("Provider dispatch secret must be at least 32 characters");
  const gatewayOrigin = origin(process.env.GATEWAY_ORIGIN ?? "http://127.0.0.1:4100");
  const providerOrigin = origin(process.env.EMETER_PROVIDER_ORIGIN ?? "http://127.0.0.1:4110");
  const rpcUrl = process.env.X_LAYER_RPC_URL ?? "https://rpc.xlayer.tech";
  const networkMode = process.env.EMETER_NETWORK_MODE ?? "mainnet";
  if (networkMode !== "mainnet" && networkMode !== "local-fork") throw new Error("Invalid network mode");
  if (networkMode === "local-fork" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname))
    throw new Error("Local fork mode requires a loopback RPC");
  const settlementGasBudget = BigInt(process.env.EMETER_RELAYER_GAS_BUDGET_WEI ?? "1000000000000000");
  if (settlementGasBudget <= 0n) throw new Error("Invalid relayer gas budget");
  return {
    databaseUrl: process.env.DATABASE_URL!, redisUrl: process.env.REDIS_URL!,
    rpcUrl, chainId: 196, networkMode,
    vault: getAddress(process.env.EMETER_VAULT_ADDRESS ?? engine.contracts.vault),
    registry: getAddress(process.env.EMETER_REGISTRY_ADDRESS ?? engine.contracts.registry),
    token: getAddress(original.contracts.demoToken), adapter: getAddress(original.contracts.adapter),
    deployer: getAddress(process.env.EMETER_DEPLOYER_ADDRESS || engine.operator),
    providerSigner: getAddress(process.env.EMETER_PROVIDER_SIGNER_ADDRESS || engine.secondCustomer),
    container: getAddress(original.contracts.serviceContainer),
    deploymentBlock: BigInt(process.env.EMETER_INDEXER_START_BLOCK ?? engine.steps[0].blockNumber),
    gatewayOrigin, providerOrigin,
    allowedProviderOrigins: (process.env.EMETER_PROVIDER_ORIGINS ?? providerOrigin).split(",").map(v => origin(v.trim())),
    dispatchSecret, confirmations: integer("EMETER_CONFIRMATIONS", 3, 1, 128),
    queuePrefix: process.env.EMETER_QUEUE_PREFIX ?? "emeter-" + engine.contracts.vault.toLowerCase().slice(2),
    settlementGasBudget, executionTimeoutMs: integer("EMETER_EXECUTION_TIMEOUT_MS", 28_000, 1_000, 30_000)
  };
}

export function redisConnection(url: string): RedisOptions {
  const u = new URL(url);
  if (!["redis:", "rediss:"].includes(u.protocol)) throw new Error("Unsupported Redis URL");
  return { host: u.hostname, port: Number(u.port || "6379"), db: Number(u.pathname.slice(1) || "0"),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}), maxRetriesPerRequest: null };
}

export function createRedisClient(url: string, worker = false) {
  const client = new Redis({ ...redisConnection(url), replyMapping: "legacy",
    maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: false });
  client.on("error", () => { /* Health checks and durable jobs report availability. */ });
  return client;
}
