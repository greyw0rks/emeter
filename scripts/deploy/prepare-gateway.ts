import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { emeterVaultAbi } from "@emeter/shared";
import { loadExternalSigner } from "../lib/signer.js";
import { config, repoRoot, xLayerChain } from "../lib/config.js";

const engine = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196-engine.json"), "utf8"));
const original = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196.json"), "utf8"));
const hosted = JSON.parse(await readFile(join(repoRoot, "deployments/convex.json"), "utf8"));
const operator = await loadExternalSigner(getAddress(engine.operator));
const settings = config();
const clients = [settings.rpc, settings.secondaryRpc].map(url => createPublicClient({ chain: xLayerChain, transport: http(url, { timeout: 15_000, retryCount: 1 }) }));
if (!(await Promise.all(clients.map(client => client.getChainId()))).every(id => id === 196)) throw new Error("CHAIN_ID_MISMATCH");
const heads = await Promise.all(clients.map(client => client.getBlockNumber({ cacheTime: 0 })));
const blockNumber = (heads[0]! < heads[1]! ? heads[0]! : heads[1]!) - 3n;
const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber })));
if (blocks[0]!.hash !== blocks[1]!.hash) throw new Error("INDEPENDENT_RPC_BLOCK_MISMATCH");
const client = clients[0]!;
const [balance, available, demo, gasPrice, providerAllowed] = await Promise.all([
  client.getBalance({ address: operator.address }),
  client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [operator.address] }),
  client.readContract({ address: original.contracts.demoToken, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [operator.address] }),
  client.getGasPrice(), client.readContract({ address: engine.contracts.registry, abi: parseAbi(["function providerAllowed(address) view returns(bool)"]), functionName: "providerAllowed", args: [operator.address] })
]);
const directory = join(homedir(), ".local/share/emeter/credentials");
await mkdir(directory, { recursive: true, mode: 0o700 });
const path = join(directory, "convex-runtime.env");
let source: string | undefined;
try { source = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (!source) {
  const providerKey = generatePrivateKey(), relayerKey = generatePrivateKey();
  const provider = privateKeyToAccount(providerKey), relayer = privateKeyToAccount(relayerKey);
  const otari = join(directory, "otari.env");
  process.loadEnvFile(otari);
  if (!process.env.OTARI_API_KEY) throw new Error("OTARI_API_KEY_NOT_CONFIGURED");
  const values = {
    EMETER_PROVIDER_PRIVATE_KEY: providerKey, EMETER_PROVIDER_SIGNER_ADDRESS: provider.address,
    EMETER_RELAYER_PRIVATE_KEY: relayerKey, EMETER_RELAYER_ADDRESS: relayer.address,
    EMETER_PROVIDER_DISPATCH_SECRET: randomBytes(32).toString("hex"), OTARI_API_KEY: process.env.OTARI_API_KEY,
    GATEWAY_ORIGIN: hosted.production.httpUrl, EMETER_PROVIDER_ORIGIN: hosted.production.httpUrl,
    EMETER_PROVIDER_ORIGINS: hosted.production.httpUrl,
    EMETER_BROWSER_ORIGINS: "http://127.0.0.1:3100,http://localhost:3100",
    X_LAYER_RPC_URL: settings.rpc, EMETER_NETWORK_MODE: "mainnet", EMETER_MAINNET_ENABLED: "false",
    EMETER_INDEXER_START_BLOCK: (blockNumber + 1n).toString(), EMETER_CONFIRMATIONS: "3",
    EMETER_RELAYER_GAS_BUDGET_WEI: "1000000000000000", EMETER_AI_USD_BUDGET_NANO: "10000000",
    EMETER_AI_PROVIDER: "otari", EMETER_AI_MODEL: "mistralai/mistral-small-3.2-24b"
  };
  source = Object.entries(values).map(([name,value]) => name + "=" + JSON.stringify(value)).join("\n") + "\n";
  await writeFile(path, source, { flag: "wx", mode: 0o600 });
}
await chmod(path, 0o600);
const values = Object.fromEntries(source.trim().split(/\r?\n/).map(line => {
  const split = line.indexOf("="); return [line.slice(0, split), JSON.parse(line.slice(split + 1))];
}));
const provider = privateKeyToAccount(values.EMETER_PROVIDER_PRIVATE_KEY), relayer = privateKeyToAccount(values.EMETER_RELAYER_PRIVATE_KEY);
if (provider.address.toLowerCase() === operator.address.toLowerCase() || relayer.address.toLowerCase() === operator.address.toLowerCase()) throw new Error("OPERATOR_KEY_MUST_REMAIN_LOCAL");
if (provider.address !== values.EMETER_PROVIDER_SIGNER_ADDRESS || relayer.address !== values.EMETER_RELAYER_ADDRESS) throw new Error("RUNTIME_SIGNER_ADDRESS_MISMATCH");
const publicPlan = {
  kind: "mainnet-gateway-activation-plan", chainId: 196, backend: hosted.production.httpUrl,
  operator: operator.address, provider: provider.address, relayer: relayer.address,
  anchor: { blockNumber: blockNumber.toString(), blockHash: blocks[0]!.hash, independentRpcAgreement: true },
  operatorBalanceWei: balance.toString(), existingCreditBaseUnits: available.toString(), operatorDemoBaseUnits: demo.toString(),
  gasPriceWei: gasPrice.toString(), providerAllowlisted: providerAllowed,
  relayerFundingWei: "1000000000000000", operatorNativeSpendCeilingWei: settings.nativeSpendCap.toString(),
  aiReportedCostCeilingUsd: "0.01", proofSessionBudgetBaseUnits: "100000", proofMaximumChargeBaseUnits: "50000",
  credentials: "Dedicated runtime keys are stored externally; the operator key is not included.", broadcastPerformed: false
};
await writeFile(join(repoRoot, "deployments/xlayer-196-gateway-plan.json"), JSON.stringify(publicPlan, null, 2) + "\n");
console.log(JSON.stringify(publicPlan, null, 2));
