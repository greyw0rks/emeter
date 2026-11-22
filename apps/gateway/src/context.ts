import { Queue } from "bullmq";
import { createDatabase } from "@emeter/database";
import { createPublicClient, defineChain, http } from "viem";
import { EmeterSessionClient } from "@emeter/sdk";
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
export type GatewayContext = ReturnType<typeof createContext> & {
  /** HTTP-action credentials are hashed before crossing the Convex action boundary. */
  credentialHash?: string;
  issuedCredentialHash?: string;
};
export { readiness } from "./readiness.js";
