import { buildGateway } from "./app.js";
import { recordedMainnetProofVerified } from "./proof-status.js";
import { loadGatewayConfig, loadRuntimeEnvironment } from "./config.js";
import { createContext } from "./context.js";

await loadRuntimeEnvironment();
const context = process.env.DATABASE_URL ? createContext(await loadGatewayConfig()) : undefined;
const app = buildGateway({ recordedMainnetProofVerified: await recordedMainnetProofVerified(), ...(context ? { context } : {}) });
await app.listen({ host: process.env.GATEWAY_HOST ?? "127.0.0.1", port: Number(process.env.GATEWAY_PORT ?? 4100) });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => { await app.close(); await context?.close(); });
}
