import { createAnalyzer } from "./ai.js";
import { loadGatewayConfig } from "./config.js";
import { createContext } from "./context.js";
import { buildProvider } from "./providers.js";
import { loadExternalSigner } from "../../../scripts/lib/signer.js";

const ctx = createContext(await loadGatewayConfig());
const account = await loadExternalSigner(ctx.config.providerSigner);
const analyzer = await createAnalyzer(ctx.config.container, account.signMessage);
const app = buildProvider(ctx, account, analyzer);
await app.listen({ host: "127.0.0.1", port: Number(new URL(ctx.config.providerOrigin).port || "4110") });
console.log("emeter providers ready: " + analyzer.model);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => { await app.close(); await ctx.close(); });
