import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, getAddress, http, keccak256, parseAbi } from "viem";
import type { Address, Hex } from "viem";
import { EmeterClient } from "@emeter/sdk";
import type { EmeterResult } from "@emeter/sdk";
import { canonicalJson, emeterRegistryAbi, emeterVaultAbi, jsonSafe, manifestHash, serviceSetHash, sessionIdFor } from "@emeter/shared";
import { config, repoRoot, xLayerChain } from "../lib/config.js";
import { loadExternalSigner } from "../lib/signer.js";

let phase = "read-activation";
const owners: EmeterClient[] = [];
try {
  const read = async (path: string) => JSON.parse(await readFile(join(repoRoot, path), "utf8"));
  const activation = await read("deployments/xlayer-196-gateway.json");
  const plan = await read("deployments/xlayer-196-gateway-plan.json");
  const engine = await read("deployments/xlayer-196-engine.json");
  const original = await read("deployments/xlayer-196.json");
  assert.equal(activation.kind, "convex-mainnet-gateway-activation");
  assert.equal(activation.requests.length, 3);
  assert.equal(activation.operator.toLowerCase(), engine.operator.toLowerCase());
  assert.equal(activation.gatewayUrl, plan.backend);
  assert.equal(activation.budgetBaseUnits, "100000");
  assert.equal(activation.unusedRefundedBaseUnits, "10000");
  const settings = config(), rpcUrls = [settings.rpc, settings.secondaryRpc];
  const operator = { address: getAddress(activation.operator) };
  const refresh = process.argv.includes("--refresh");
  const signer = refresh ? await loadExternalSigner(operator.address) : undefined;
  const published = refresh ? undefined : await read("docs/evidence/gateway-mainnet-requests.json");
  const recordedFetch: typeof fetch = async input => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/api/protocol") return Response.json({ name: "emeter", phase: "paid-gateway", chainId: 196,
      mainnetProofVerified: true, paidExecutionReady: false, networkMode: "mainnet", confirmations: 3,
      vault: engine.contracts.vault, registry: engine.contracts.registry, token: original.contracts.demoToken, decimals: 6, rpcUrl: settings.rpc });
    if (url.pathname.startsWith("/api/requests/")) {
      const record = published?.requests.find((item: EmeterResult) => item.requestId === url.pathname.split("/").at(-1));
      if (record) return Response.json(record);
    }
    throw new Error("UNSUPPORTED_RECORDED_EVIDENCE_READ");
  };
  const records: EmeterResult[] = [];
  phase = "verify-signed-requests";
  for (const rpcUrl of rpcUrls) {
    const owner = new EmeterClient({ gatewayUrl: activation.gatewayUrl, rpcUrl, vault: engine.contracts.vault, registry: engine.contracts.registry,
      ...(refresh ? {} : { fetch: recordedFetch }) });
    if (signer) { owners.push(owner); await owner.authenticate(signer); }
    const network = await owner.getNetwork();
    assert.equal(network.networkMode, "mainnet");
    for (const [index, request] of activation.requests.entries()) {
      const result = await owner.verifyRequest(request.requestId);
      assert(result.receiptVerified && result.settlementVerified);
      assert.equal(result.sessionId, activation.sessionId);
      assert.equal(result.serviceId, request.serviceId);
      assert.equal(result.priceBaseUnits, request.priceBaseUnits);
      assert.equal(result.policyInputs, request.policyInputs);
      if (rpcUrl === rpcUrls[0]) records.push(result);
      else assert.equal(canonicalJson(jsonSafe(result)), canonicalJson(jsonSafe(records[index])));
    }
  }
  const paid = records.reduce((sum, record) => sum + BigInt(record.priceBaseUnits), 0n);
  assert.equal(paid, 90_000n);
  assert.deepEqual(records.map(record => record.policyInputs), [31, 31, 47]);
  const ai = records.find(record => record.call.method === "text_analyze")!;
  const aiData = ai.data as { model: { id: string; runtime: string }; usageEvidence: { receipt: { result: {
    usage: unknown; prices: { currency: string; amount: string }[] | null
  } } } };
  assert.equal(aiData.model.runtime, "otari-api");
  const usd = aiData.usageEvidence.receipt.result.prices?.find(price => price.currency === "USD");
  assert(usd, "A recomputed reported USD cost is required for this proof");
  const [whole, fraction = ""] = usd.amount.split(".");
  assert(BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0")) <= 1_000_000n);

  phase = "verify-mainnet-accounting";
  const refundStep = activation.walletTransactions.find((step: any) => step.name === "refund-session");
  assert(refundStep);
  const beforeBlock = BigInt(plan.anchor.blockNumber), proofBlock = BigInt(refundStep.blockNumber);
  const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const reports = [];
  for (const rpcUrl of rpcUrls) {
    const client = createPublicClient({ chain: xLayerChain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
    assert.equal(await client.getChainId(), 196);
    assert.equal((await client.getBlock({ blockNumber: beforeBlock })).hash, plan.anchor.blockHash);
    assert(await client.getBlockNumber({ cacheTime: 0 }) >= proofBlock + 3n);
    const snapshot = async (blockNumber: bigint) => {
      const [customer, provider, vault, available, locked, totalAvailable, totalPaid, nativeCustomer, nativeRelayer] = await Promise.all([
        client.readContract({ address: original.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [operator.address], blockNumber }),
        client.readContract({ address: original.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [activation.provider], blockNumber }),
        client.readContract({ address: original.contracts.demoToken, abi: tokenAbi, functionName: "balanceOf", args: [engine.contracts.vault], blockNumber }),
        client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [operator.address], blockNumber }),
        client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "totalLocked", blockNumber }),
        client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "totalAvailable", blockNumber }),
        client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "totalPaid", blockNumber }),
        client.getBalance({ address: operator.address, blockNumber }), client.getBalance({ address: activation.relayer, blockNumber })
      ]);
      return { customer, provider, vault, available, locked, totalAvailable, totalPaid, nativeCustomer, nativeRelayer };
    };
    const [before, after, session, block] = await Promise.all([
      snapshot(beforeBlock), snapshot(proofBlock),
      client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "getSession", args: [activation.sessionId], blockNumber: proofBlock }),
      client.getBlock({ blockNumber: proofBlock })
    ]);
    assert.equal(before.customer - after.customer, paid);
    assert.equal(after.provider - before.provider, paid);
    assert.equal(after.vault, before.vault);
    assert.equal(after.available, before.available);
    assert.equal(after.locked, before.locked);
    assert.equal(after.totalAvailable, before.totalAvailable);
    assert.equal(after.totalPaid - before.totalPaid, paid);
    assert.equal(session.customer.toLowerCase(), operator.address.toLowerCase());
    assert.equal(session.signer.toLowerCase(), operator.address.toLowerCase());
    assert.equal(session.budget, 100_000n);
    assert.equal(session.softLimit, 80_000n);
    assert.equal(session.maxCharge, 50_000n);
    assert.equal(session.spent, paid);
    assert.equal(session.balance, 0n);
    assert.equal(session.refundedAmount, 10_000n);
    assert.equal(session.status, 3);
    assert(session.signerRevoked && block.timestamp >= session.refundAfter);
    assert.equal(session.refundAfter, session.expiresAt + session.settlementWindow);
    const wallet = [], settlements = [];
    let operatorCost = 0n, relayerCost = 0n;
    for (const step of activation.walletTransactions) {
      const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash: step.hash }), client.getTransaction({ hash: step.hash })]);
      assert.equal(receipt.status, "success");
      assert.equal(receipt.blockNumber.toString(), step.blockNumber);
      assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
      assert.equal(transaction.blockHash, receipt.blockHash);
      assert.equal(transaction.from.toLowerCase(), operator.address.toLowerCase());
      assert.equal(transaction.to?.toLowerCase(), step.to.toLowerCase());
      assert.equal(transaction.value.toString(), step.valueWei);
      const cost = transaction.value + receipt.gasUsed * receipt.effectiveGasPrice;
      assert.equal(cost.toString(), step.actualCostWei);
      operatorCost += cost;
      if (step.name === "fund-relayer") {
        assert.equal(transaction.to?.toLowerCase(), activation.relayer.toLowerCase());
        assert.equal(transaction.value.toString(), plan.relayerFundingWei);
        assert.equal(transaction.input, "0x");
      } else if (step.name.startsWith("register-")) {
        const manifest = records.find(record => "register-" + record.call.method === step.name)!.serviceManifest;
        assert.equal(transaction.input, encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService",
          args: [manifest.serviceId as Hex, manifest.payout as Address, manifest.signer as Address, manifest.container as Address, BigInt(manifest.priceBaseUnits), manifestHash(manifest)] }));
      } else if (step.name === "create-session") {
        const decoded = decodeFunctionData({ abi: emeterVaultAbi, data: transaction.input });
        assert.equal(decoded.functionName, "createSession");
        if (decoded.functionName === "createSession") {
          const [grant, ids] = decoded.args;
          assert.equal(sessionIdFor(engine.contracts.vault, grant.customer, grant.nonce), activation.sessionId);
          assert.equal(grant.serviceSetHash, serviceSetHash([...new Set(records.map(record => record.serviceId))]));
          assert.equal(grant.budget, session.budget);
          assert.equal(grant.expiresAt, session.expiresAt);
          assert.equal(grant.settlementWindow, session.settlementWindow);
          assert.equal(ids.length, 2);
        }
      }
      if (step.name === "refund-session") {
        const returned = receipt.logs.some(log => {
          if (log.address.toLowerCase() !== original.contracts.demoToken.toLowerCase()) return false;
          try { const event = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics });
            return event.eventName === "Transfer" && event.args.from.toLowerCase() === engine.contracts.vault.toLowerCase()
              && event.args.to.toLowerCase() === operator.address.toLowerCase() && event.args.value === 10_000n;
          } catch { return false; }
        });
        assert(returned, "Refund must transfer directly to the fixed customer");
      }
      wallet.push({ name: step.name, hash: step.hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
        inputHash: keccak256(transaction.input), nonce: transaction.nonce, costWei: cost.toString() });
    }
    for (const record of records) {
      const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash: record.transaction!.hash }), client.getTransaction({ hash: record.transaction!.hash })]);
      assert.equal(transaction.from.toLowerCase(), activation.relayer.toLowerCase());
      assert.equal(transaction.value, 0n);
      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      relayerCost += cost;
      settlements.push({ requestId: record.requestId, hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
        inputHash: keccak256(transaction.input), costWei: cost.toString(), policyInputs: record.policyInputs, priceBaseUnits: record.priceBaseUnits });
    }
    assert.equal(operatorCost.toString(), activation.operatorNativeSpendWei);
    assert.equal(before.nativeCustomer - after.nativeCustomer, operatorCost);
    assert(operatorCost <= BigInt(plan.operatorNativeSpendCeilingWei));
    assert.equal(after.nativeRelayer - before.nativeRelayer, BigInt(plan.relayerFundingWei) - relayerCost);
    assert(relayerCost <= BigInt(plan.relayerFundingWei));
    reports.push(jsonSafe({ proofBlock: proofBlock.toString(), proofBlockHash: block.hash, before, after, session, wallet, settlements, operatorCostWei: operatorCost, relayerCostWei: relayerCost }));
  }
  assert.deepEqual(reports[0], reports[1]);
  const report = { kind: "paid-gateway-mainnet-verification", chainId: 196, independentRpcAgreement: true,
    requestEvidenceSource: refresh ? "authenticated-live-gateway" : "retained-public-signed-records", newAiCallsDuringVerification: 0,
    rpcOperators: rpcUrls.map(url => new URL(url).hostname), gatewayUrl: activation.gatewayUrl,
    participantClassification: activation.participantClassification, independentAdoption: false,
    realAiRequests: 1, fixtureAiRequests: 0, aiModel: aiData.model, reportedUsage: aiData.usageEvidence.receipt.result.usage,
    recomputedReportedUsdCost: usd.amount, aiSpendCeilingUsd: "0.01", paidBaseUnits: paid.toString(), refundedBaseUnits: "10000",
    ...reports[0] as Record<string, unknown>, checkedAt: new Date().toISOString() };
  await writeFile(join(repoRoot, "docs/evidence/gateway-mainnet-requests.json"), JSON.stringify(jsonSafe({
    kind: "builder-mainnet-signed-request-evidence", chainId: 196, gatewayUrl: activation.gatewayUrl, requests: records
  }), null, 2) + "\n");
  await writeFile(join(repoRoot, "docs/evidence/gateway-mainnet-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, independentRpcAgreement: true, settledRequests: records.length, paidBaseUnits: paid.toString(), refundedBaseUnits: "10000", recomputedReportedUsdCost: usd.amount }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, errorCode: "MAINNET_GATEWAY_VERIFICATION_FAILED", name: error instanceof Error ? error.name : "Error" }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled(owners.map(owner => owner.logout()));
}
