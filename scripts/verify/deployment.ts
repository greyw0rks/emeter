import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, decodeEventLog,
  decodeFunctionData, encodeDeployData, http, keccak256, parseAbi
} from "viem";
import type { Address, Hex } from "viem";
import { POLICY_V1, flagsFromMask, packPolicyInputs, policyDecision } from "@emeter/circuit";
import { processorAbi } from "@emeter/shared";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { readArtifact, stringify } from "../lib/proof.js";

type Journal = {
  kind: string; completed: boolean; chainId: number; circuitId: string;
  customer: Address; providerSigner: Address; processor: Address; factory: Address; beacon: Address;
  contracts: { demoToken: Address; adapter: Address; vault: Address; serviceContainer: Address };
  configuration: { customer: Address; provider: Address; providerSigner: Address; serviceContainer: Address; serviceId: Hex; price: string; hardBudget: string; softLimit: string; expiresAt: string; settlementWindow: string };
  steps: { label: string; hash: Hex; blockNumber: string; blockHash: Hex; status: string; from: Address; to: Address | null; valueWei: string; contractAddress: Address | null; dataHash: Hex }[];
};

try {
  const journal = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196.json"), "utf8")) as Journal;
  if (journal.kind !== "mainnet" || !journal.completed || journal.chainId !== 196 || journal.steps.length !== 12) throw new Error("Complete the mainnet proof before final verification");
  const cfg = config();
  const [tokenArtifact, adapterArtifact, vaultArtifact] = await Promise.all([readArtifact("DemoUSD"), readArtifact("EmeterPolicyAdapter"), readArtifact("EmeterProofVault")]);
  const clients = [cfg.rpc, cfg.secondaryRpc].map(url => createPublicClient({ chain: xLayerChain, transport: http(url, { timeout: 20_000, retryCount: 1 }) }));
  const heads = await Promise.all(clients.map(async client => {
    if (await client.getChainId() !== 196) throw new Error("Deployment verifier RPC has wrong network");
    return client.getBlockNumber();
  }));
  const verificationHeadBlock = heads.reduce((a, b) => a < b ? a : b);
  const completedRefund = journal.steps.find(step => step.label === "refund-unused-demo-balance");
  if (!completedRefund) throw new Error("Mainnet proof has no completed refund");
  // This is a historical proof: later legitimate DEMO transfers must not
  // invalidate its original final balances or recorded circuit ownership.
  const blockNumber = BigInt(completedRefund.blockNumber);
  if (blockNumber > verificationHeadBlock) throw new Error("Proof completion block is not available");
  const circuitId = BigInt(journal.circuitId);
  const tokenAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
  const cpuEvents = parseAbi(["event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)"]);
  const parsedConfig = { ...journal.configuration, price: BigInt(journal.configuration.price), hardBudget: BigInt(journal.configuration.hardBudget), softLimit: BigInt(journal.configuration.softLimit), expiresAt: BigInt(journal.configuration.expiresAt), settlementWindow: BigInt(journal.configuration.settlementWindow) };
  const expectedCreations = {
    "deploy-demo-token": encodeDeployData({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode, args: [journal.customer] }),
    "deploy-adapter": encodeDeployData({ abi: adapterArtifact.abi, bytecode: adapterArtifact.bytecode, args: [journal.factory, journal.processor, circuitId, journal.beacon] }),
    "deploy-proof-vault": encodeDeployData({ abi: vaultArtifact.abi, bytecode: vaultArtifact.bytecode, args: [journal.contracts.demoToken, journal.contracts.adapter, parsedConfig] })
  };
  const verifications = await Promise.all(clients.map(async client => {
    for (const address of [journal.contracts.demoToken, journal.contracts.adapter, journal.contracts.vault]) {
      const code = await client.getCode({ address, blockNumber });
      if (!code || code === "0x") throw new Error("Missing deployed contract code");
    }
    const [netlist, info, owner, customerBalance, providerBalance, vaultBalance, trackedBalance, spent, refunded] = await Promise.all([
      client.readContract({ address: journal.processor, abi: processorAbi, functionName: "netlist", args: [circuitId], blockNumber }),
      client.readContract({ address: journal.processor, abi: processorAbi, functionName: "circuitInfo", args: [circuitId], blockNumber }),
      client.readContract({ address: journal.processor, abi: parseAbi(["function ownerOf(uint256 id) view returns (address)"]), functionName: "ownerOf", args: [circuitId], blockNumber }),
      client.readContract({ address: journal.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [journal.customer], blockNumber }),
      client.readContract({ address: journal.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [journal.providerSigner], blockNumber }),
      client.readContract({ address: journal.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [journal.contracts.vault], blockNumber }),
      client.readContract({ address: journal.contracts.vault, abi: vaultArtifact.abi, functionName: "balance", blockNumber }) as Promise<bigint>,
      client.readContract({ address: journal.contracts.vault, abi: vaultArtifact.abi, functionName: "spent", blockNumber }) as Promise<bigint>,
      client.readContract({ address: journal.contracts.vault, abi: vaultArtifact.abi, functionName: "refunded", blockNumber }) as Promise<boolean>
    ]);
    if (netlist !== POLICY_V1.netlist || info.join(",") !== "6,1,0,11" || owner.toLowerCase() !== journal.customer.toLowerCase()) throw new Error("Published circuit identity or bytes mismatch");
    if (customerBalance !== 900_000n || providerBalance !== 100_000n || vaultBalance !== 0n || trackedBalance !== 0n || spent !== 100_000n || !refunded) throw new Error("Final chain balances or refund state mismatch");

    let truthTableInputs = 0;
    for (let start = 0; start < 64; start += 8) {
      await Promise.all(Array.from({ length: 8 }, async (_, offset) => {
        const flags = flagsFromMask(start + offset);
        const output = await client.readContract({ address: journal.processor, abi: processorAbi, functionName: "eval", args: [circuitId, packPolicyInputs(flags)], blockNumber });
        if (output !== (policyDecision(flags) ? "0x01" : "0x00")) throw new Error("Mainnet policy truth-table mismatch");
      }));
      truthTableInputs += 8;
    }
    const checkedSteps = [];
    for (const step of journal.steps) {
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: step.hash }), client.getTransaction({ hash: step.hash })]);
      if (receipt.blockHash !== step.blockHash || receipt.blockNumber.toString() !== step.blockNumber || receipt.status !== step.status || tx.from.toLowerCase() !== journal.customer.toLowerCase() || keccak256(tx.input) !== step.dataHash || tx.value.toString() !== step.valueWei) throw new Error(`Transaction journal mismatch: ${step.label}`);
      const expectedStatus = step.label === "deny-soft-limit-request" ? "reverted" : "success";
      if (receipt.status !== expectedStatus) throw new Error(`Unexpected chain status: ${step.label}`);
      if (step.label in expectedCreations) {
        if (tx.to !== null || tx.input !== expectedCreations[step.label as keyof typeof expectedCreations] || receipt.contractAddress?.toLowerCase() !== step.contractAddress?.toLowerCase()) throw new Error("Creation transaction does not match compiled source and configuration");
      }
      if (step.label === "publish-policy") {
        const events = receipt.logs.filter(log => log.address.toLowerCase() === journal.processor.toLowerCase()).flatMap(log => {
          try { return [decodeEventLog({ abi: cpuEvents, data: log.data, topics: log.topics })]; } catch { return []; }
        });
        if (!events.some(event => event.args.circuitId === circuitId && event.args.author.toLowerCase() === journal.customer.toLowerCase() && event.args.gateCount === 11 && event.args.nState === 0)) throw new Error("Missing matching circuit publication event");
      }
      if (step.label === "settle-allowed-request" || step.label === "settle-signed-override") {
        const expectedMask = step.label === "settle-allowed-request" ? 31 : 47;
        const matching = receipt.logs.some(log => {
          if (log.address.toLowerCase() !== journal.contracts.vault.toLowerCase()) return false;
          try {
            const event = decodeEventLog({ abi: vaultArtifact.abi, data: log.data, topics: log.topics });
            const args = event.args as { amount?: bigint; policyInputs?: number; circuitId?: bigint; processor?: Address; provider?: Address };
            return event.eventName === "ChargeSettled" && args.amount === 50_000n && Number(args.policyInputs) === expectedMask && args.circuitId === circuitId && args.processor?.toLowerCase() === journal.processor.toLowerCase() && args.provider?.toLowerCase() === journal.providerSigner.toLowerCase();
          } catch { return false; }
        });
        if (!matching) throw new Error("Missing matching circuit-gated settlement event");
      }
      if (step.label === "deny-soft-limit-request") {
        const decoded = decodeFunctionData({ abi: vaultArtifact.abi, data: tx.input });
        let correctRevert = false;
        try { await client.simulateContract({ address: journal.contracts.vault, abi: vaultArtifact.abi, functionName: "settle", args: decoded.args, account: journal.customer, blockNumber: receipt.blockNumber - 1n }); }
        catch (error) {
          if (error instanceof BaseError) {
            const reverted = error.walk(item => item instanceof ContractFunctionRevertedError);
            correctRevert = reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === "PolicyDenied" && Number(reverted.data.args?.[0]) === 15;
          }
        }
        if (!correctRevert) throw new Error("Historical state does not reproduce PolicyDenied(15)");
        const historicalResults = await Promise.all([31, 15].map(inputs => client.readContract({
          address: journal.contracts.adapter, abi: adapterArtifact.abi, functionName: "isAllowed",
          args: [inputs], blockNumber: receipt.blockNumber - 1n
        })));
        if (historicalResults[0] !== true || historicalResults[1] !== false) throw new Error("Historical adapter does not distinguish allowed and denied circuit inputs");
      }
      checkedSteps.push({ label: step.label, hash: step.hash, status: receipt.status, blockNumber: receipt.blockNumber.toString() });
    }
    return { blockNumber: blockNumber.toString(), verificationHeadBlock: verificationHeadBlock.toString(), historicalProof: true, circuitId: circuitId.toString(), truthTableInputs, creationInputsMatchCompiledArtifacts: true, historicalDenialVerified: "PolicyDenied(15)", balances: { customer: customerBalance.toString(), provider: providerBalance.toString(), vault: vaultBalance.toString(), spent: spent.toString(), refunded }, checkedSteps };
  }));
  if (JSON.stringify(verifications[0]) !== JSON.stringify(verifications[1])) throw new Error("Independent RPC deployment verification disagrees");
  const report = { kind: "mainnet-read-only-verification", checkedAt: new Date().toISOString(), chainId: 196, independentRpcAgreement: true, rpcOperators: [new URL(cfg.rpc).hostname, new URL(cfg.secondaryRpc).hostname], ...verifications[0] };
  await writeFile(join(repoRoot, "docs/evidence/mainnet-verification.json"), stringify(report));
  console.log(stringify(report));
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Deployment verification failed");
  process.exitCode = 1;
}
