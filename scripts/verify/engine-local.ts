import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi } from "viem";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { createProofClients } from "../lib/proof.js";
import { runEngineProof } from "../lib/engine-proof.js";
import { verifyXLayer } from "../lib/verification.js";

const cfg = config();
const verified = await verifyXLayer();
const original = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196.json"), "utf8")) as {
  customer: Address; contracts: { demoToken: Address; adapter: Address; serviceContainer: Address }
};
const gasPrice = await createPublicClient({ transport: http(cfg.rpc) }).getGasPrice();
const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const bound = server.address();
if (!bound || typeof bound === "string") throw new Error("No free local port");
const port = bound.port;
await new Promise<void>(resolve => server.close(() => resolve()));
const rpc = `http://127.0.0.1:${port}`;
const child = spawn(process.env.EMETER_ANVIL_BINARY || "anvil", ["--fork-url", cfg.rpc,
  "--fork-block-number", verified.blockNumber, "--chain-id", "196", "--port", String(port),
  "--host", "127.0.0.1", "--gas-price", gasPrice.toString(), "--silent"], { stdio: "ignore" });
let stopped = false;
child.once("error", () => { stopped = true; });
child.once("exit", () => { stopped = true; });
const operator = privateKeyToAccount(generatePrivateKey());
const secondCustomer = privateKeyToAccount(generatePrivateKey());
const clients = createProofClients(rpc, operator);
const testClient = createTestClient({ chain: xLayerChain, mode: "anvil", transport: http(rpc) });
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopped) throw new Error("Anvil stopped before fork was ready");
    try { if (await clients.publicClient.getChainId() === 196) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Anvil did not start");
  await testClient.setBalance({ address: operator.address, value: 1_000_000_000_000_000_000n });
  await testClient.setBalance({ address: original.customer, value: 1_000_000_000_000_000_000n });
  // Impersonation and minting occur only in this local Anvil fork.
  await testClient.impersonateAccount({ address: original.customer });
  const minter = createWalletClient({ chain: xLayerChain, account: original.customer, transport: http(rpc) });
  const minted = await minter.writeContract({ address: original.contracts.demoToken,
    abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [operator.address, 500_000n],
    maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: 1n });
  await clients.publicClient.waitForTransactionReceipt({ hash: minted });
  await testClient.stopImpersonatingAccount({ address: original.customer });
  await runEngineProof({ kind: "anvil-fork", rpc, clients, operator, secondCustomer,
    token: original.contracts.demoToken, adapter: original.contracts.adapter, container: original.contracts.serviceContainer,
    outputPath: join(repoRoot, "docs/evidence/engine-anvil-proof.json"),
    nativeSpendCap: 20_000_000_000_000_000n, upstreamBlock: verified.blockNumber,
    advanceTo: async timestamp => { await testClient.setNextBlockTimestamp({ timestamp }); await testClient.mine({ blocks: 1 }); }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Engine Anvil proof failed");
  process.exitCode = 1;
} finally { child.kill("SIGTERM"); }
