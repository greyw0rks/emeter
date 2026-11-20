import { loadGatewayConfig } from "./config.js";
import { createContext } from "./context.js";
import { startWorkers } from "./worker.js";
import { loadExternalSigner } from "../../../scripts/lib/signer.js";

const ctx = createContext(await loadGatewayConfig());
const account = await loadExternalSigner(ctx.config.deployer);
const workers = await startWorkers(ctx, account);
console.log("emeter execution, settlement, and chain indexer ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => { await workers.close(); await ctx.close(); });
