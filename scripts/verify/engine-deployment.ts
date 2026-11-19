import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseError, ContractFunctionRevertedError, createPublicClient, decodeEventLog,
  decodeFunctionData, encodeDeployData, http, keccak256, parseAbi, recoverTypedDataAddress } from "viem";
import type { Address, Hex } from "viem";
import { emeterRegistryAbi, emeterVaultAbi, overrideSigningPayload } from "@emeter/shared";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { readArtifact, stringify } from "../lib/proof.js";

type EngineJournal = {
  kind: string; completed: boolean; operator: Address; secondCustomer: Address; token: Address; adapter: Address;
  container: Address; contracts: { registry: Address; vault: Address };
  services: { serviceA: Hex; serviceB: Hex; metadataHashA: Hex; metadataHashB: Hex; metadataHashANext: Hex };
  sessions: { first: { sessionId: Hex; authorization: { signer: Address } }; second: { sessionId: Hex; authorization: { signer: Address } } };
  tokenBalancesBefore: { operator: string; secondCustomer: string };
  nativeBalanceBefore: string; nativeBalanceAfter: string; nativeSpendWei: string;
  steps: { label: string; hash: Hex; status: "success" | "reverted"; blockNumber: string; blockHash: Hex; dataHash: Hex; contractAddress: Address | null }[];
};

try {
  const journal = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196-engine.json"), "utf8")) as EngineJournal;
  if (journal.kind !== "mainnet" || !journal.completed || journal.steps.length !== 18) throw new Error("Complete the 18-transaction mainnet engine proof first");
  const cfg = config();
  const [registryArtifact, vaultArtifact] = await Promise.all([readArtifact("EmeterRegistry"), readArtifact("EmeterVault")]);
  const clients = [cfg.rpc, cfg.secondaryRpc].map(rpc => createPublicClient({ chain: xLayerChain, transport: http(rpc, { timeout: 20_000, retryCount: 1 }) }));
  const refundStep = journal.steps.find(step => step.label === "refund-customer-two");
  if (!refundStep) throw new Error("Missing customer-two refund receipt");
  const blockNumber = BigInt(refundStep.blockNumber);
  const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const expectedCreations = {
    "deploy-registry": encodeDeployData({ abi: registryArtifact.abi, bytecode: registryArtifact.bytecode, args: [journal.operator] }),
    "deploy-session-vault": encodeDeployData({ abi: vaultArtifact.abi, bytecode: vaultArtifact.bytecode,
      args: [journal.token, journal.contracts.registry, journal.adapter] })
  };
  const reports = await Promise.all(clients.map(async client => {
    if (await client.getChainId() !== 196) throw new Error("Wrong verification network");
    const [first, second, a1, a2, b1, allowedProvider, paid, locked, available, held, opBalance, secondBalance] = await Promise.all([
      client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "getSession", args: [journal.sessions.first.sessionId], blockNumber }),
      client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "getSession", args: [journal.sessions.second.sessionId], blockNumber }),
      client.readContract({ address: journal.contracts.registry, abi: emeterRegistryAbi, functionName: "getPriceVersion", args: [journal.services.serviceA, 1], blockNumber }),
      client.readContract({ address: journal.contracts.registry, abi: emeterRegistryAbi, functionName: "getPriceVersion", args: [journal.services.serviceA, 2], blockNumber }),
      client.readContract({ address: journal.contracts.registry, abi: emeterRegistryAbi, functionName: "getPriceVersion", args: [journal.services.serviceB, 1], blockNumber }),
      client.readContract({ address: journal.contracts.registry, abi: emeterRegistryAbi, functionName: "providerAllowed", args: [journal.operator], blockNumber }),
      client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "totalPaid", blockNumber }),
      client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "totalLocked", blockNumber }),
      client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "totalAvailable", blockNumber }),
      client.readContract({ address: journal.token, abi: tokenAbi, functionName: "balanceOf", args: [journal.contracts.vault], blockNumber }),
      client.readContract({ address: journal.token, abi: tokenAbi, functionName: "balanceOf", args: [journal.operator], blockNumber }),
      client.readContract({ address: journal.token, abi: tokenAbi, functionName: "balanceOf", args: [journal.secondCustomer], blockNumber })
    ]);
    if (first.customer.toLowerCase() !== journal.operator.toLowerCase() || second.customer.toLowerCase() !== journal.secondCustomer.toLowerCase()
      || first.signer.toLowerCase() !== journal.sessions.first.authorization.signer.toLowerCase()
      || second.signer.toLowerCase() !== journal.sessions.second.authorization.signer.toLowerCase()
      || first.budget !== 200_000n || second.budget !== 200_000n || first.softLimit !== 50_000n || second.softLimit !== 50_000n
      || first.maxCharge !== 50_000n || second.maxCharge !== 50_000n || first.status !== 3 || second.status !== 3
      || first.spent !== 70_000n || second.spent !== 30_000n || first.refundedAmount !== 130_000n || second.refundedAmount !== 170_000n
      || first.balance !== 0n || second.balance !== 0n) throw new Error("Session scope, budgets, payments, or refunds do not match");
    if (!allowedProvider || a1.price !== 20_000n || a2.price !== 30_000n || b1.price !== 50_000n
      || a1.metadataHash !== journal.services.metadataHashA || a2.metadataHash !== journal.services.metadataHashANext
      || b1.metadataHash !== journal.services.metadataHashB) throw new Error("Registry price-version mismatch");
    for (const terms of [a1, a2, b1]) {
      if (!terms.enabled || terms.payout.toLowerCase() !== journal.secondCustomer.toLowerCase()
        || terms.signer.toLowerCase() !== journal.secondCustomer.toLowerCase()
        || terms.container.toLowerCase() !== journal.container.toLowerCase()) throw new Error("Versioned provider identity mismatch");
    }
    if (paid !== 100_000n || locked !== 0n || available !== 0n || held !== 0n
      || opBalance !== BigInt(journal.tokenBalancesBefore.operator) - 270_000n
      || secondBalance !== BigInt(journal.tokenBalancesBefore.secondCustomer) + 270_000n) throw new Error("Engine token conservation mismatch");
    const scoped = await Promise.all([
      [journal.sessions.first.sessionId, journal.services.serviceA], [journal.sessions.first.sessionId, journal.services.serviceB],
      [journal.sessions.second.sessionId, journal.services.serviceA], [journal.sessions.second.sessionId, journal.services.serviceB]
    ].map(args => client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi,
      functionName: "sessionServiceAllowed", args: [args[0]!, args[1]!], blockNumber })));
    if (scoped.join(",") !== "true,true,true,false") throw new Error("Signed session service scope mismatch");
    let nativeCost = 0n;
    const checked = [];
    for (const step of journal.steps) {
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: step.hash }), client.getTransaction({ hash: step.hash })]);
      const expected = step.label === "deny-delegate-self-override" ? "reverted" : "success";
      if (receipt.status !== expected || receipt.status !== step.status || receipt.blockHash !== step.blockHash
        || receipt.blockNumber.toString() !== step.blockNumber || tx.from.toLowerCase() !== journal.operator.toLowerCase()
        || tx.value !== 0n || keccak256(tx.input) !== step.dataHash) throw new Error(`Engine transaction mismatch: ${step.label}`);
      nativeCost += receipt.gasUsed * receipt.effectiveGasPrice;
      if (step.label in expectedCreations && (tx.to !== null || tx.input !== expectedCreations[step.label as keyof typeof expectedCreations]
        || receipt.contractAddress?.toLowerCase() !== step.contractAddress?.toLowerCase())) throw new Error("Creation input does not match compiled engine source");
      const paymentExpectations: Record<string, [bigint, number, number, Hex]> = {
        "settle-pinned-version-one": [20_000n, 1, 31, journal.sessions.first.sessionId],
        "settle-customer-authorized-override": [50_000n, 1, 47, journal.sessions.first.sessionId],
        "settle-customer-two-version-two": [30_000n, 2, 31, journal.sessions.second.sessionId]
      };
      const payment = paymentExpectations[step.label];
      if (payment) {
        const matches = receipt.logs.some(log => {
          if (log.address.toLowerCase() !== journal.contracts.vault.toLowerCase()) return false;
          try {
            const event = decodeEventLog({ abi: emeterVaultAbi, data: log.data, topics: log.topics });
            return event.eventName === "ChargeSettled" && event.args.amount === payment[0]
              && event.args.priceVersion === payment[1] && event.args.policyInputs === payment[2]
              && event.args.sessionId === payment[3] && event.args.provider.toLowerCase() === journal.secondCustomer.toLowerCase();
          } catch { return false; }
        });
        if (!matches) throw new Error("Missing scoped, versioned settlement event");
      }
      if (step.label === "deny-delegate-self-override") {
        const decoded = decodeFunctionData({ abi: emeterVaultAbi, data: tx.input });
        if (decoded.functionName !== "settle") throw new Error("Denial is not a settlement attempt");
        const evidence = decoded.args[0];
        const signer = await recoverTypedDataAddress({ ...overrideSigningPayload(journal.contracts.vault, evidence.softLimitOverride), signature: evidence.customerOverrideSignature });
        if (signer.toLowerCase() !== first.signer.toLowerCase() || signer.toLowerCase() === first.customer.toLowerCase()) throw new Error("Denial did not attempt a delegated self-override");
        const preview = await client.readContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "previewSettlement", args: [evidence], blockNumber: receipt.blockNumber - 1n });
        if (preview[1] !== 15 || preview[2] !== false) throw new Error("Historical policy input/result mismatch");
        let denied = false;
        try { await client.simulateContract({ address: journal.contracts.vault, abi: emeterVaultAbi, functionName: "settle", args: [evidence], account: journal.operator, blockNumber: receipt.blockNumber - 1n }); }
        catch (error) {
          if (error instanceof BaseError) {
            const reverted = error.walk(item => item instanceof ContractFunctionRevertedError);
            denied = reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === "PolicyDenied" && Number(reverted.data.args?.[0]) === 15;
          }
        }
        if (!denied) throw new Error("Historical state does not deny the delegated override");
      }
      checked.push({ label: step.label, hash: step.hash, status: receipt.status, blockNumber: receipt.blockNumber.toString() });
    }
    if (nativeCost !== BigInt(journal.nativeSpendWei) || BigInt(journal.nativeBalanceBefore) - BigInt(journal.nativeBalanceAfter) !== nativeCost) throw new Error("Native fee accounting mismatch");
    return { proofBlock: blockNumber.toString(), creationInputsMatchCompiledArtifacts: true,
      delegatedOverrideDenied: "PolicyDenied(15)", scopedServicesVerified: true,
      prices: { originalJson: "20000", newJson: "30000", wordCount: "50000" },
      sessions: { firstSpent: first.spent.toString(), secondSpent: second.spent.toString(), firstRefund: first.refundedAmount.toString(), secondRefund: second.refundedAmount.toString() },
      totals: { paid: paid.toString(), locked: locked.toString(), available: available.toString() }, nativeCostWei: nativeCost.toString(), checked };
  }));
  if (JSON.stringify(reports[0]) !== JSON.stringify(reports[1])) throw new Error("Independent RPC engine verification disagrees");
  const report = { kind: "payment-engine-mainnet-verification", chainId: 196, checkedAt: new Date().toISOString(),
    independentRpcAgreement: true, rpcOperators: [new URL(cfg.rpc).hostname, new URL(cfg.secondaryRpc).hostname], ...reports[0] };
  await writeFile(join(repoRoot, "docs/evidence/engine-mainnet-verification.json"), stringify(report));
  console.log(stringify(report));
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Engine verification failed");
  process.exitCode = 1;
}
