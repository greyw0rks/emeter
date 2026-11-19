import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address } from "viem";
import { config, repoRoot } from "../lib/config.js";
import { createProofClients, readArtifact } from "../lib/proof.js";
import { runEngineProof } from "../lib/engine-proof.js";
import { loadExternalSigner } from "../lib/signer.js";
import { verifyXLayer } from "../lib/verification.js";

try {
  if (!process.argv.includes("--broadcast")) throw new Error("Engine mainnet execution requires --broadcast");
  const outputPath = join(repoRoot, "deployments/xlayer-196-engine.json");
  if (existsSync(outputPath)) throw new Error("An engine deployment journal exists; reconcile it before another deployment");
  const cfg = config();
  const local = JSON.parse(await readFile(join(repoRoot, "docs/evidence/engine-anvil-proof.json"), "utf8")) as {
    kind: string; completed: boolean; artifactHashes: { registry: string; vault: string }
  };
  if (local.kind !== "anvil-fork" || !local.completed) throw new Error("Complete the engine Anvil transaction rehearsal first");
  const [registry, vault] = await Promise.all([readArtifact("EmeterRegistry"), readArtifact("EmeterVault")]);
  if (registry.bytecodeSha256 !== local.artifactHashes.registry || vault.bytecodeSha256 !== local.artifactHashes.vault) throw new Error("Engine contracts changed after the verified rehearsal");
  const original = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196.json"), "utf8")) as {
    completed: boolean; contracts: { demoToken: Address; adapter: Address; serviceContainer: Address }
  };
  if (!original.completed) throw new Error("Original TapeOut proof is incomplete");
  const verified = await verifyXLayer();
  const [operator, secondCustomer] = await Promise.all([loadExternalSigner(cfg.deployer), loadExternalSigner(cfg.provider)]);
  const clients = createProofClients(cfg.rpc, operator);
  if (await clients.publicClient.getBalance({ address: operator.address }) < 500_000_000_000_000n) throw new Error("Operator needs more OKB for engine deployment gas");
  await runEngineProof({ kind: "mainnet", rpc: cfg.rpc, clients, operator, secondCustomer,
    token: original.contracts.demoToken, adapter: original.contracts.adapter, container: original.contracts.serviceContainer,
    outputPath, nativeSpendCap: 1_500_000_000_000_000n, upstreamBlock: verified.blockNumber
  });
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Engine mainnet proof failed");
  process.exitCode = 1;
}
