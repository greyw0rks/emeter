"use node";

import { createPublicClient, defineChain, getAddress, http } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EmeterSessionClient } from "@emeter/sdk";
import original from "../../deployments/xlayer-196.json";
import engine from "../../deployments/xlayer-196-engine.json";
import hosted from "../../deployments/convex.json";
import type { GatewayConfig } from "../../apps/gateway/src/config";
import type { GatewayContext } from "../../apps/gateway/src/context";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { createConvexDatabase, StorageError } from "./database";
import type { JobFence } from "./database";
import { createConvexQueue } from "./queue";

function origin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
    throw new Error("INVALID_PUBLIC_ORIGIN");
  return url.origin;
}
export function signer(role: "provider" | "relayer", address: Address) {
  const key = process.env[role === "provider" ? "EMETER_PROVIDER_PRIVATE_KEY" : "EMETER_RELAYER_PRIVATE_KEY"];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RUNTIME_SIGNER_NOT_CONFIGURED");
  const account = privateKeyToAccount(key as Hex);
  if (account.address.toLowerCase() !== address.toLowerCase()) throw new Error("RUNTIME_SIGNER_ADDRESS_MISMATCH");
  return account;
}
export function runtimeConfig(): GatewayConfig {
  const rpcUrl = process.env.X_LAYER_RPC_URL ?? "https://rpc.xlayer.tech";
  const rpc = new URL(rpcUrl), networkMode = process.env.EMETER_NETWORK_MODE ?? "mainnet";
  if (!["mainnet", "local-fork"].includes(networkMode) || rpc.username || rpc.password || rpc.search || rpc.hash)
    throw new Error("INVALID_RUNTIME_NETWORK");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname);
  if (networkMode === "local-fork" ? !loopback : rpc.protocol !== "https:" || loopback) throw new Error("INVALID_RUNTIME_RPC");
  const gatewayOrigin = origin(process.env.GATEWAY_ORIGIN ?? process.env.CONVEX_SITE_URL ?? hosted.production.httpUrl);
  const providerOrigin = origin(process.env.EMETER_PROVIDER_ORIGIN ?? gatewayOrigin);
  const dispatchSecret = process.env.EMETER_PROVIDER_DISPATCH_SECRET ?? "";
  const deployer = getAddress(process.env.EMETER_RELAYER_ADDRESS ?? engine.operator);
  const providerSigner = getAddress(process.env.EMETER_PROVIDER_SIGNER_ADDRESS ?? engine.secondCustomer);
  let signingReady = false;
  try { signer("provider", providerSigner); signer("relayer", deployer); signingReady = true; } catch { /* Read-only configuration remains usable. */ }
  const confirmations = Number(process.env.EMETER_CONFIRMATIONS ?? 3);
  const settlementGasBudget = BigInt(process.env.EMETER_RELAYER_GAS_BUDGET_WEI ?? "1000000000000000");
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 128 || settlementGasBudget <= 0n) throw new Error("INVALID_RUNTIME_LIMITS");
  const executionEnabled = (networkMode === "local-fork" || process.env.EMETER_MAINNET_ENABLED === "true")
    && dispatchSecret.length >= 32 && signingReady && Boolean(process.env.OTARI_API_KEY);
  return {
    databaseUrl: "convex://records", redisUrl: "convex://scheduler", chainId: 196, rpcUrl, networkMode: networkMode as "mainnet" | "local-fork",
    vault: getAddress(engine.contracts.vault), registry: getAddress(engine.contracts.registry), token: getAddress(original.contracts.demoToken),
    adapter: getAddress(original.contracts.adapter), container: getAddress(original.contracts.serviceContainer),
    deployer, providerSigner, deploymentBlock: BigInt(process.env.EMETER_INDEXER_START_BLOCK ?? engine.steps[0]!.blockNumber),
    gatewayOrigin, providerOrigin, browserOrigins: (process.env.EMETER_BROWSER_ORIGINS ?? "http://127.0.0.1:3100,http://localhost:3100").split(",").map(value => origin(value.trim())),
    allowedProviderOrigins: (process.env.EMETER_PROVIDER_ORIGINS ?? providerOrigin).split(",").map(value => origin(value.trim())),
    dispatchSecret, confirmations, queuePrefix: "emeter-convex-" + engine.contracts.vault.toLowerCase(),
    settlementGasBudget, executionTimeoutMs: 28_000, executionEnabled, indexerBatchBlocks: 100, indexerMaxBatches: 4,
    cursorFreshnessMs: 75_000, workerFreshnessMs: 75_000
  };
}

export async function createRuntimeContext(ctx: ActionCtx, fence?: JobFence): Promise<GatewayContext> {
  const config = runtimeConfig();
  const control = await ctx.runQuery(internal.store.control, fence ? { fence } : {});
  if (control.paused) config.executionEnabled = false;
  const chain = defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const rpc = createPublicClient({ chain, pollingInterval: 500, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  const client = { ...rpc, sendRawTransaction: async (args: Parameters<typeof rpc.sendRawTransaction>[0]) => {
    const current = await ctx.runQuery(internal.store.control, fence ? { fence } : {});
    if (!config.executionEnabled || current.paused || !current.validJob || !fence) throw new StorageError("BROADCAST_NOT_AUTHORIZED");
    const cursor = await ctx.runQuery(internal.store.read, { model: "indexerCursor", query: { where: { id: config.vault.toLowerCase() } }, mode: "findUnique", cursor: null });
    const state = cursor.rows[0]?.data;
    if (!state || state.state !== "ready" || (await rpc.getBlock({ blockNumber: BigInt(state.blockNumber) })).hash !== state.blockHash)
      throw new StorageError("CHAIN_REORG_RECONCILIATION_REQUIRED");
    return rpc.sendRawTransaction(args);
  } };
  return { config, chain, client, db: createConvexDatabase(ctx, fence),
    sessions: new EmeterSessionClient({ rpcUrl: config.rpcUrl, vault: config.vault, registry: config.registry }),
    executionQueue: createConvexQueue(ctx, config.queuePrefix, "execution"),
    settlementQueue: createConvexQueue(ctx, config.queuePrefix, "settlement"), close: async () => undefined } as unknown as GatewayContext;
}
