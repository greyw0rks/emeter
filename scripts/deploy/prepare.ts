import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatEther } from "viem";
import { config, repoRoot } from "../lib/config.js";
import { stringify } from "../lib/proof.js";
import { verifyXLayer } from "../lib/verification.js";

const cfg = config();
const verified = await verifyXLayer();
let forkProof: Record<string, unknown> | null = null;
try { forkProof = JSON.parse(await readFile(join(repoRoot, "docs/evidence/anvil-fork-proof.json"), "utf8")); } catch { /* pending */ }
const prepared = {
  name: "emeter", kind: "mainnet-deployment-plan", createdAt: new Date().toISOString(), chainId: 196,
  deployer: cfg.deployer, providerSigner: cfg.provider, processor: cfg.processor, factory: cfg.factory, beacon: cfg.beacon,
  preflightBlock: verified.blockNumber, independentRpcAgreement: verified.independentRpcAgreement,
  nativeProtocolCostWei: verified.processor.nativeProtocolCost,
  nativeProtocolCostOkb: formatEther(BigInt(verified.processor.nativeProtocolCost)),
  currentBalanceOkb: formatEther(BigInt(verified.deployer.nativeBalanceWei)),
  configuredSpendCapWei: cfg.nativeSpendCap.toString(),
  forkProofCompleted: forkProof?.completed === true && forkProof?.kind === "anvil-fork",
  forkObservedNativeSpendWei: forkProof?.nativeSpendWeiExcludingAdditionalL1Fees ?? null,
  forkMeasuredGas: forkProof?.steps ?? null,
  steps: ["Mint 11 NAND transistor tokens if needed", "Publish the exact generated policy and read its circuit ID from TapedOut", "Verify all 64 inputs", "Deploy DemoUSD, the pinned adapter, and the single-service proof vault", "Mint and deposit zero-value DEMO", "Settle an authenticated request", "Record an actual reverted soft-limit transaction", "Settle a customer-signed override", "Refund unused DEMO after the settlement window"],
  requiresBemPurchase: false, mainnetBroadcastPerformed: false,
  scope: "Protocol proof only. Paid HTTP services, registry, session keys, and full UI follow."
};
await mkdir(join(repoRoot, "deployments"), { recursive: true });
await writeFile(join(repoRoot, "deployments/xlayer-196-plan.json"), stringify(prepared));
console.log(stringify(prepared));
