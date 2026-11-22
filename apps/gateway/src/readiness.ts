import { parseAbi } from "viem";
import { emeterVaultAbi } from "@emeter/shared";
import { readServiceCatalog } from "./services.js";
import type { GatewayContext } from "./context.js";

export async function readiness(ctx: GatewayContext) {
  if (ctx.config.executionEnabled === false) return false;
  try {
    const [chainId, queue, cursor, code, circuitReady, circuitDenies, heartbeat, registry, token, adapter, services] = await Promise.all([
      ctx.client.getChainId(), ctx.executionQueue.getJobCounts(),
      ctx.db.indexerCursor.findUnique({ where: { id: ctx.config.vault.toLowerCase() } }),
      ctx.client.getCode({ address: ctx.config.vault }),
      ctx.client.readContract({ address: ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]), functionName: "isAllowed", args: [31] }),
      ctx.client.readContract({ address: ctx.config.adapter, abi: parseAbi(["function isAllowed(uint8) view returns(bool)"]), functionName: "isAllowed", args: [15] }),
      ctx.db.workerHeartbeat.findUnique({ where: { id: ctx.config.queuePrefix } }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "registry" }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "token" }),
      ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "adapter" }),
      readServiceCatalog(ctx)
    ]);
    return chainId === 196 && Boolean(queue) && Boolean(code && code !== "0x") && cursor?.state === "ready" && circuitReady && !circuitDenies
      && cursor.updatedAt.getTime() > Date.now() - (ctx.config.cursorFreshnessMs ?? 20_000) && services.services.length > 0
      && registry.toLowerCase() === ctx.config.registry.toLowerCase() && token.toLowerCase() === ctx.config.token.toLowerCase()
      && adapter.toLowerCase() === ctx.config.adapter.toLowerCase()
      && Boolean(heartbeat && heartbeat.updatedAt.getTime() > Date.now() - (ctx.config.workerFreshnessMs ?? 15_000));
  } catch { return false; }
}
