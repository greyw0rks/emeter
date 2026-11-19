import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config, repoRoot } from "../lib/config.js";
import { createProofClients, readArtifact, runProof } from "../lib/proof.js";
import { loadExternalSigner } from "../lib/signer.js";
import { verifyXLayer } from "../lib/verification.js";

try {
  if (!process.argv.includes("--broadcast")) throw new Error("Run pnpm deploy:prepare to review the proof; mainnet execution uses --broadcast");
  const cfg = config();
  const outputPath = join(repoRoot, "deployments/xlayer-196.json");
  if (existsSync(outputPath)) throw new Error("A mainnet proof journal already exists; reconcile it before another deployment");
  const forkProof = JSON.parse(await readFile(join(repoRoot, "docs/evidence/anvil-fork-proof.json"), "utf8")) as Record<string, unknown>;
  if (forkProof.kind !== "anvil-fork" || forkProof.completed !== true || forkProof.truthTablePassed !== 64) {
    throw new Error("Complete the actual Anvil fork transaction proof before mainnet execution");
  }
  const artifacts = await Promise.all(["DemoUSD", "EmeterPolicyAdapter", "EmeterProofVault"].map(readArtifact));
  const hashes = forkProof.artifactHashes as Record<string, string>;
  for (const [index, name] of ["DemoUSD", "EmeterPolicyAdapter", "EmeterProofVault"].entries()) {
    if (hashes[name] !== artifacts[index]!.bytecodeSha256) throw new Error("Contract artifacts changed after the successful fork proof");
  }
  const verified = await verifyXLayer();
  if (BigInt(verified.deployer.nativeBalanceWei) < BigInt(verified.processor.nativeProtocolCost) + 200_000_000_000_000n) {
    throw new Error("The deployment wallet needs more OKB on X Layer");
  }
  const [customer, provider] = await Promise.all([loadExternalSigner(cfg.deployer), loadExternalSigner(cfg.provider)]);
  await runProof({
    kind: "mainnet", clients: createProofClients(cfg.rpc, customer), customer, provider,
    processor: cfg.processor, outputPath, nativeSpendCap: cfg.nativeSpendCap, upstreamBlock: verified.blockNumber
  });
} catch (error) {
  const message = error instanceof Error ? error.message.split("\n")[0] : "Mainnet proof failed";
  console.error(message);
  process.exitCode = 1;
}
