import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, encodeDeployData, formatEther, getAddress, http, keccak256, parseAbi } from "viem";
import { X_LAYER_USDC, LEGACY_DEPLOYMENT, emeterVaultAbi } from "@emeter/shared";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { readArtifact } from "../lib/proof.js";

const cfg = config();
const clients = [cfg.rpc, cfg.secondaryRpc].map(url => createPublicClient({ chain: xLayerChain, transport: http(url, { timeout: 20_000, retryCount: 1 }) }));
assert((await Promise.all(clients.map(client => client.getChainId()))).every(id => id === 196));
const heads = await Promise.all(clients.map(client => client.getBlockNumber({ cacheTime: 0 })));
const blockNumber = (heads[0]! < heads[1]! ? heads[0]! : heads[1]!) - 3n;
const abi = parseAbi(["function symbol() view returns(string)", "function name() view returns(string)", "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)"]);
const observations = await Promise.all(clients.map(async client => {
  const [block, code, symbol, name, decimals, balance, legacyToken] = await Promise.all([
    client.getBlock({ blockNumber }), client.getCode({ address: X_LAYER_USDC.address, blockNumber }),
    client.readContract({ address: X_LAYER_USDC.address, abi, functionName: "symbol", blockNumber }),
    client.readContract({ address: X_LAYER_USDC.address, abi, functionName: "name", blockNumber }),
    client.readContract({ address: X_LAYER_USDC.address, abi, functionName: "decimals", blockNumber }),
    client.readContract({ address: X_LAYER_USDC.address, abi, functionName: "balanceOf", args: [cfg.deployer], blockNumber }),
    client.readContract({ address: LEGACY_DEPLOYMENT.vault, abi: emeterVaultAbi, functionName: "token", blockNumber }),
  ]);
  assert(code && code !== "0x"); assert.equal(symbol, "USDC"); assert.equal(decimals, 6);
  assert.equal(getAddress(legacyToken), getAddress(LEGACY_DEPLOYMENT.token));
  return { blockHash: block.hash, codeHash: keccak256(code), symbol, name, decimals, operatorBalanceBaseUnits: balance.toString() };
}));
assert.deepEqual(observations[0], observations[1], "Independent RPC agreement");
const artifact = await readArtifact("EmeterVault");
const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode,
  args: [X_LAYER_USDC.address, LEGACY_DEPLOYMENT.registry, LEGACY_DEPLOYMENT.adapter] });
const client = clients[0]!;
const [estimatedGas, gasPrice, head, nativeBalance, oldAvailable, oldLocked] = await Promise.all([
  client.estimateGas({ account: cfg.deployer, data }), client.getGasPrice(), client.getBlock(), client.getBalance({ address: cfg.deployer }),
  client.readContract({ address: LEGACY_DEPLOYMENT.vault, abi: emeterVaultAbi, functionName: "totalAvailable" }),
  client.readContract({ address: LEGACY_DEPLOYMENT.vault, abi: emeterVaultAbi, functionName: "totalLocked" }),
]);
const gasLimit = estimatedGas * 12n / 10n + 10_000n;
const base = (head.baseFeePerGas ?? 0n) > gasPrice ? head.baseFeePerGas! : gasPrice;
const tip = base / 10n || 1n, maxFeePerGas = base * 2n + tip;
const maximumGasCostWei = gasLimit * maxFeePerGas;
const report = { kind: "usdc-mainnet-read-only-preflight", createdAt: new Date().toISOString(), chainId: 196,
  token: X_LAYER_USDC.address, ...observations[0], blockNumber: blockNumber.toString(), independentRpcAgreement: true,
  references: ["https://github.com/okx/xlayer-tokenlist/blob/main/xlayer.tokenlist.json", "https://github.com/okx/xlayer-docs/blob/main/developer/bridge/usdc-on-x-layer.mdx"],
  operator: cfg.deployer, operatorNativeBalanceWei: nativeBalance.toString(),
  historicalDemo: { vault: LEGACY_DEPLOYMENT.vault, totalAvailableBaseUnits: oldAvailable.toString(), totalLockedBaseUnits: oldLocked.toString() },
  deployment: { registry: LEGACY_DEPLOYMENT.registry, adapter: LEGACY_DEPLOYMENT.adapter,
    artifactSha256: artifact.bytecodeSha256, dataHash: keccak256(data), estimatedGas: estimatedGas.toString(), gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: tip.toString(), maximumGasCostWei: maximumGasCostWei.toString(),
    maximumGasCostOkb: formatEther(maximumGasCostWei), fundedForMaximumGas: nativeBalance >= maximumGasCostWei,
    stablecoinTransferred: false, broadcastPerformed: false } };
await writeFile(join(repoRoot, "docs/evidence/usdc-preflight.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
