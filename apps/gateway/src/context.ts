import { Queue } from "bullmq";
import { createDatabase } from "@emeter/database";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { EmeterSessionClient } from "@emeter/sdk";
import { emeterVaultAbi } from "@emeter/shared";
import { readServiceCatalog } from "./services.js";
import type { GatewayConfig } from "./config.js";
import { createRedisClient } from "./config.js";

export function createContext(config: GatewayConfig) {
  const chain = defineChain({ id: 196, name: "X Layer",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } } });
  const client = createPublicClient({ chain, pollingInterval: 500, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  const db = createDatabase(config.databaseUrl);
  const connection = createRedisClient(config.redisUrl);
  const executionQueue = new Queue("execution", { connection, prefix: config.queuePrefix,
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 500, removeOnFail: 500 } });
  const settlementQueue = new Queue("settlement", { connection, prefix: config.queuePrefix,
    defaultJobOptions: { attempts: 8, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 500, removeOnFail: 500 } });
  const sessions = new EmeterSessionClient({ rpcUrl: config.rpcUrl, vault: config.vault, registry: config.registry });
  executionQueue.on("error", () => { /* Readiness reports an unavailable queue. */ });
  settlementQueue.on("error", () => { /* Prepared transactions stay in PostgreSQL. */ });
  return { config, chain, client, db, executionQueue, settlementQueue, sessions,
    close: async () => { await executionQueue.close(); await settlementQueue.close(); connection.disconnect(); await db.$disconnect(); } };
}
export type GatewayContext = ReturnType<typeof createContext>;

export async function readiness(ctx: GatewayContext) {
  try {
    const [chainId, redis, cursor, code, circuitReady, circuitDenies, heartbeat, registry, token, adapter, services] = await Promise.all([
      ctx.client.getChainId(), ctx.executionQueue.getJobCounts(),
      ctx.db.indexerCursor.findUnique({ where: { id: ctx.config.vault.toLowerCase() } }),
      ctx.client.getCode({ address: ctx.config.vault }),
      ctx.client.readContract({ address: ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]),
        functionName: "isAllowed", args: [31] }),
      ctx.client.readContract({ address: ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]),
        functionName: "isAllowed", args: [15] }),
      ctx.db.workerHeartbeat.findUnique({ where: { id: ctx.config.queuePrefix } }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "registry" }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "token" }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "adapter" }),
      readServiceCatalog(ctx)
    ]);
    return chainId === 196 && Boolean(redis) && Boolean(code && code !== "0x") && cursor?.state === "ready" && circuitReady && !circuitDenies
      && cursor.updatedAt.getTime() > Date.now() - 20_000 && services.services.length > 0
      && registry.toLowerCase() === ctx.config.registry.toLowerCase() && token.toLowerCase() === ctx.config.token.toLowerCase()
      && adapter.toLowerCase() === ctx.config.adapter.toLowerCase()
      && Boolean(heartbeat && heartbeat.updatedAt.getTime() > Date.now() - 15_000);
  } catch { return false; }
}
