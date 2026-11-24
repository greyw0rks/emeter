import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, encodeDeployData, getAddress, http, keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import type { Hex, TransactionSerialized } from "viem";
import { emeterVaultAbi, LEGACY_DEPLOYMENT, X_LAYER_USDC } from "@emeter/shared";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { readArtifact } from "../lib/proof.js";
import { loadExternalSigner } from "../lib/signer.js";

/** One contract-creation transaction. Never mints or transfers payment tokens.
 * Signed bytes are journaled before broadcast and resumed without a new nonce.
 */
async function main() {
  const cfg = config(), cap = 200_000_000_000_000n; // 0.0002 OKB, including padded maximum gas.
  const path = join(repoRoot, "deployments/xlayer-196-usdc.json");
  const deployment = JSON.parse(await readFile(path, "utf8"));
  if (deployment.completed) { console.log(JSON.stringify({ alreadyDeployed: true, vault: deployment.contracts.vault })); return; }
  const [artifact, rehearsal, preflight] = await Promise.all([
    readArtifact("EmeterVault"),
    readFile(join(repoRoot, "docs/evidence/usdc-fork-checks.json"), "utf8").then(JSON.parse),
    readFile(join(repoRoot, "docs/evidence/usdc-preflight.json"), "utf8").then(JSON.parse),
  ]);
  assert(rehearsal.passed && rehearsal.testsPassed === 4 && !rehearsal.mainnetBroadcastPerformed);
  assert.equal(rehearsal.vaultBytecodeSha256, artifact.bytecodeSha256);
  assert.equal(preflight.deployment.artifactSha256, artifact.bytecodeSha256);
  assert(preflight.independentRpcAgreement && preflight.token.toLowerCase() === X_LAYER_USDC.address.toLowerCase());
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode,
    args: [X_LAYER_USDC.address, LEGACY_DEPLOYMENT.registry, LEGACY_DEPLOYMENT.adapter] });
  assert.equal(keccak256(data), preflight.deployment.dataHash);
  const clients = [cfg.rpc, cfg.secondaryRpc].map(url => createPublicClient({ chain: xLayerChain, transport: http(url, { timeout: 20_000, retryCount: 1 }) }));
  assert((await Promise.all(clients.map(client => client.getChainId()))).every(id => id === 196));
  const client = clients[0]!;
  const [estimatedGas, price, block, balance] = await Promise.all([
    client.estimateGas({ account: cfg.deployer, data }), client.getGasPrice(), client.getBlock(), client.getBalance({ address: cfg.deployer }),
  ]);
  const gas = estimatedGas * 12n / 10n + 10_000n, base = (block.baseFeePerGas ?? 0n) > price ? block.baseFeePerGas! : price;
  const tip = base / 10n || 1n, maxFeePerGas = base * 2n + tip;
  assert(gas * maxFeePerGas <= cap, "USDC_VAULT_GAS_CAP_EXCEEDED");
  assert(balance >= gas * maxFeePerGas, "OPERATOR_NEEDS_OKB");
  if (!process.argv.includes("--broadcast")) {
    console.log(JSON.stringify({ prepared: true, token: X_LAYER_USDC.address, operator: cfg.deployer, gas: gas.toString(),
      maximumGasCostWei: (gas * maxFeePerGas).toString(), configuredCeilingWei: cap.toString(),
      artifactSha256: artifact.bytecodeSha256, dataHash: keccak256(data), tokenTransfers: 0, broadcastPerformed: false }, null, 2));
    return;
  }
  const operator = await loadExternalSigner(cfg.deployer);
  const directory = join(homedir(), ".local/share/emeter/activation");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journalPath = join(directory, "xlayer-196-usdc-vault.json");
  let journal: { raw: Hex; hash: Hex; dataHash: Hex };
  try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const [nonce, latest] = await Promise.all([
      client.getTransactionCount({ address: operator.address, blockTag: "pending" }),
      client.getTransactionCount({ address: operator.address, blockTag: "latest" }),
    ]);
    assert.equal(nonce, latest, "OPERATOR_HAS_PENDING_TRANSACTION");
    const raw = await operator.signTransaction({ chainId: 196, data, value: 0n, gas, maxFeePerGas, maxPriorityFeePerGas: tip, nonce, type: "eip1559" });
    journal = { raw, hash: keccak256(raw), dataHash: keccak256(data) };
    await writeFile(journalPath, JSON.stringify(journal) + "\n", { mode: 0o600, flag: "wx" });
  }
  assert.equal(keccak256(journal.raw), journal.hash); assert.equal(journal.dataHash, keccak256(data));
  assert(journal.raw.startsWith("0x02"), "EXPECTED_EIP1559_DEPLOYMENT_TRANSACTION");
  assert.equal((await recoverTransactionAddress({ serializedTransaction: journal.raw as TransactionSerialized })).toLowerCase(), operator.address.toLowerCase());
  const signed = parseTransaction(journal.raw);
  assert.equal(signed.data, data); assert.equal(signed.value ?? 0n, 0n); assert(!signed.to);
  assert.equal(signed.chainId, 196); assert(signed.gas! * signed.maxFeePerGas! <= cap);
  let receipt = await client.getTransactionReceipt({ hash: journal.hash }).catch(() => null);
  if (!receipt) {
    try { assert.equal(await client.sendRawTransaction({ serializedTransaction: journal.raw }), journal.hash); }
    catch (error) { if (!await client.getTransaction({ hash: journal.hash }).catch(() => null)) throw error; }
    receipt = await client.waitForTransactionReceipt({ hash: journal.hash, confirmations: 3, timeout: 120_000 });
  }
  assert.equal(receipt.status, "success"); assert(receipt.contractAddress);
  const vault = getAddress(receipt.contractAddress);
  for (const rpc of clients) {
    const [transaction, mined, token, registry, adapter] = await Promise.all([
      rpc.getTransaction({ hash: journal.hash }), rpc.getTransactionReceipt({ hash: journal.hash }),
      rpc.readContract({ address: vault, abi: emeterVaultAbi, functionName: "token" }),
      rpc.readContract({ address: vault, abi: emeterVaultAbi, functionName: "registry" }),
      rpc.readContract({ address: vault, abi: emeterVaultAbi, functionName: "adapter" }),
    ]);
    assert.equal(transaction.from.toLowerCase(), operator.address.toLowerCase()); assert.equal(transaction.input, data);
    assert.equal(mined.status, "success"); assert.equal(mined.blockHash, receipt.blockHash);
    assert.equal((await rpc.getBlock({ blockNumber: mined.blockNumber })).hash, mined.blockHash);
    assert.equal(getAddress(token), getAddress(X_LAYER_USDC.address));
    assert.equal(getAddress(registry), getAddress(LEGACY_DEPLOYMENT.registry)); assert.equal(getAddress(adapter), getAddress(LEGACY_DEPLOYMENT.adapter));
  }
  const result = { ...deployment, completed: true, contracts: { ...deployment.contracts, vault },
    deploymentBlock: receipt.blockNumber.toString(), transactionHash: journal.hash, blockHash: receipt.blockHash,
    artifactSha256: artifact.bytecodeSha256, independentRpcAgreement: true, gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), tokenTransfers: 0 };
  await writeFile(path, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message.split("\n")[0] : "USDC_DEPLOYMENT_FAILED"); process.exitCode = 1; });
