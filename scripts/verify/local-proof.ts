import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { createTestClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { createProofClients, runProof } from "../lib/proof.js";
import { verifyXLayer } from "../lib/verification.js";

const cfg = config();
const verified = await verifyXLayer();
const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not allocate local Anvil port");
const port = address.port;
await new Promise<void>(resolve => server.close(() => resolve()));
const rpc = `http://127.0.0.1:${port}`;
const child = spawn(process.env.EMETER_ANVIL_BINARY || "anvil", [
  "--fork-url", cfg.rpc, "--fork-block-number", verified.blockNumber,
  "--chain-id", "196", "--port", String(port), "--host", "127.0.0.1", "--silent"
], { stdio: ["ignore", "ignore", "ignore"] });
let exited = false;
child.once("exit", () => { exited = true; });
child.once("error", () => { exited = true; });
const customer = privateKeyToAccount(generatePrivateKey());
const provider = privateKeyToAccount(generatePrivateKey());
const clients = createProofClients(rpc, customer);
const testClient = createTestClient({ chain: xLayerChain, mode: "anvil", transport: http(rpc) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (exited) throw new Error("Anvil exited before the fork was ready");
    try { if (await clients.publicClient.getChainId() === 196) { ready = true; break; } } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Local X Layer fork did not start");
  await testClient.setBalance({ address: customer.address, value: 1_000_000_000_000_000_000n });
  const outputPath = join(repoRoot, "docs/evidence/anvil-fork-proof.json");
  await runProof({
    kind: "anvil-fork", clients, customer, provider, processor: cfg.processor, outputPath,
    nativeSpendCap: cfg.nativeSpendCap, upstreamBlock: verified.blockNumber,
    advanceTo: async timestamp => {
      await testClient.setNextBlockTimestamp({ timestamp });
      await testClient.mine({ blocks: 1 });
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Local proof failed");
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
