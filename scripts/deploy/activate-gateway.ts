import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseAbi, toHex } from "viem";
import type { Address, Hex } from "viem";
import { EmeterClient, EmeterSessionClient } from "@emeter/sdk";
import { canonicalJson, emeterRegistryAbi, emeterVaultAbi, jsonSafe, manifestHash, requestHash, serviceSetHash } from "@emeter/shared";
import type { ServiceCall, ServiceManifest, SessionAuthorization } from "@emeter/shared";
import { loadExternalSigner } from "../lib/signer.js";
import { config, repoRoot, xLayerChain } from "../lib/config.js";

async function main() {
const hosted = JSON.parse(await readFile(join(repoRoot, "deployments/convex.json"), "utf8"));
const plan = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196-gateway-plan.json"), "utf8"));
const engine = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196-engine.json"), "utf8"));
const original = JSON.parse(await readFile(join(repoRoot, "deployments/xlayer-196.json"), "utf8"));
const settings = config(), operator = await loadExternalSigner(getAddress(engine.operator));
const client = createPublicClient({ chain: xLayerChain, transport: http(settings.rpc, { timeout: 15_000, retryCount: 1 }), pollingInterval: 500 });
const sessions = new EmeterSessionClient({ rpcUrl: settings.rpc, vault: engine.contracts.vault, registry: engine.contracts.registry });
const gatewayUrl = hosted.production.httpUrl as string;
const broadcasts = process.argv.includes("--broadcast");
assert.equal(await client.getChainId(), 196);
const secondary = createPublicClient({ chain: xLayerChain, transport: http(settings.secondaryRpc) });
assert.equal(await secondary.getChainId(), 196);
for (const rpc of [client, secondary]) assert.equal((await rpc.getBlock({ blockNumber: BigInt(plan.anchor.blockNumber) })).hash.toLowerCase(), plan.anchor.blockHash.toLowerCase());
const storage = join(homedir(), ".local/share/emeter/activation");
await mkdir(storage, { recursive: true, mode: 0o700 });
const journalPath = join(storage, "xlayer-196-gateway.json");
type Step = { name: string; to: Address; data: Hex; valueWei: string; hash: Hex; raw: Hex; nonce: number; maximumCostWei: string; actualCostWei?: string; blockNumber?: string };
type Prepared = { clientId: string; requestId: Hex; serviceId: Hex; payload: any; verified?: boolean; policyInputs?: number; priceBaseUnits?: string };
let journal: { steps: Step[]; session?: any; requests: Prepared[]; completed?: boolean };
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; journal = { steps: [], requests: [] }; }
const save = () => writeFile(journalPath, JSON.stringify(jsonSafe(journal), null, 2) + "\n", { mode: 0o600 });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function sendOnce(name: string, to: Address, data: Hex, value = 0n) {
  if (!broadcasts) throw new Error("BROADCAST_FLAG_REQUIRED");
  assert([engine.contracts.registry, engine.contracts.vault, original.contracts.demoToken, plan.relayer].some((address: string) => address.toLowerCase() === to.toLowerCase()), "Pinned transaction destination");
  if (value > 0n) { assert.equal(to.toLowerCase(), plan.relayer.toLowerCase()); assert.equal(value.toString(), plan.relayerFundingWei); }
  let step = journal.steps.find(item => item.name === name);
  if (step) {
    assert.equal(step.to.toLowerCase(), to.toLowerCase()); assert.equal(step.data, data); assert.equal(step.valueWei, value.toString());
    assert.equal(keccak256(step.raw), step.hash);
  } else {
    const [estimate, head, gasPrice, nonce] = await Promise.all([
      client.estimateGas({ account: operator.address, to, data, value }), client.getBlock(), client.getGasPrice(),
      client.getTransactionCount({ address: operator.address, blockTag: "pending" })
    ]);
    const gas = estimate * 12n / 10n + 10_000n, base = (head.baseFeePerGas ?? 0n) > gasPrice ? head.baseFeePerGas! : gasPrice;
    const maxPriorityFeePerGas = base / 10n || 1n, maxFeePerGas = base * 2n + maxPriorityFeePerGas;
    const maximumCost = value + gas * maxFeePerGas;
    const used = journal.steps.reduce((sum,item) => sum + BigInt(item.actualCostWei ?? item.maximumCostWei), 0n);
    if (used + maximumCost > settings.nativeSpendCap) throw new Error("OPERATOR_NATIVE_SPEND_CEILING");
    if (await client.getBalance({ address: operator.address }) < maximumCost) throw new Error("OPERATOR_NEEDS_GAS");
    const raw = await operator.signTransaction({ chainId: 196, to, data, value, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, type: "eip1559" });
    step = { name, to, data, valueWei: value.toString(), nonce, raw, hash: keccak256(raw), maximumCostWei: maximumCost.toString() };
    journal.steps.push(step); await save();
  }
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: step.hash }); }
  catch {
    try { assert.equal(await client.sendRawTransaction({ serializedTransaction: step.raw }), step.hash); }
    catch (error) { try { await client.getTransaction({ hash: step.hash }); } catch { throw error; } }
    receipt = await client.waitForTransactionReceipt({ hash: step.hash, confirmations: 2, timeout: 120_000 });
  }
  assert.equal(receipt.status, "success", name);
  assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
  step.actualCostWei = (value + receipt.gasUsed * receipt.effectiveGasPrice).toString(); step.blockNumber = receipt.blockNumber.toString(); await save();
  console.log(JSON.stringify({ action: name, confirmed: true, hash: step.hash }));
  return receipt;
}
async function enableMainnet() {
  const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", join(repoRoot, "node_modules/.bin/convex"),
    "env", "set", "EMETER_MAINNET_ENABLED", "true", "--deployment", "greyw0rks:emeter:production"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume(); child.stderr.resume();
  const code = await new Promise<number|null>((resolve,reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error("MAINNET_ENABLE_FAILED");
}
if (!broadcasts) {
  const published = await (await fetch(gatewayUrl + "/.well-known/emeter.json")).json() as { services: ServiceManifest[] };
  assert.equal(published.services.length, 2);
  console.log(JSON.stringify({ prepared: true, gatewayUrl, services: published.services.map(item => ({ id: item.serviceId, name: item.name, priceBaseUnits: item.priceBaseUnits })),
    relayerFundingWei: plan.relayerFundingWei, operatorNativeSpendCeilingWei: settings.nativeSpendCap.toString(), proofBudgetBaseUnits: "100000", aiReportedCostCeilingUsd: "0.01", broadcasts: false }, null, 2));
  process.exit(0);
}
if (journal.completed) { console.log(JSON.stringify({ completed: true, alreadyActivated: true })); process.exit(0); }
const owner = new EmeterClient({ gatewayUrl, rpcUrl: settings.rpc, vault: engine.contracts.vault, registry: engine.contracts.registry });
await owner.authenticate(operator);
const published = await (await fetch(gatewayUrl + "/.well-known/emeter.json")).json() as { services: ServiceManifest[] };
assert.equal(published.services.length, 2);
for (const manifest of published.services) {
  assert.equal(manifest.signer.toLowerCase(), plan.provider.toLowerCase());
  const prepared = await owner.registerService(manifest) as any;
  if (prepared.status === "awaiting_chain_registration") {
    assert.equal(prepared.transaction.to.toLowerCase(), engine.contracts.registry.toLowerCase());
    assert.equal(prepared.transaction.data, encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService",
      args: [manifest.serviceId, manifest.payout, manifest.signer, manifest.container, BigInt(manifest.priceBaseUnits), manifestHash(manifest)] }));
    await sendOnce("register-" + manifest.method, getAddress(prepared.transaction.to), prepared.transaction.data);
    assert.equal((await owner.registerService(manifest) as any).status, "registered");
  } else assert.equal(prepared.status, "registered");
}
const relayer = getAddress(plan.relayer);
const funding = BigInt(plan.relayerFundingWei);
if (!journal.steps.some(item => item.name === "fund-relayer") && await client.getBalance({ address: relayer }) >= funding) {
  console.log(JSON.stringify({ action: "fund-relayer", existingFunding: true }));
} else await sendOnce("fund-relayer", relayer, "0x", funding);
await enableMainnet();
for (let i=0; i<60; i++) { if ((await owner.getNetwork()).paidExecutionReady) break; if (i===59) throw new Error("HOSTED_GATEWAY_NOT_READY"); await pause(2000); }
const budget = 100_000n;
if (!journal.session) {
  const available = await client.readContract({ address: engine.contracts.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [operator.address] });
  if (available < budget) {
    const amount = budget - available;
    await sendOnce("approve-demo", getAddress(original.contracts.demoToken), encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]), functionName: "approve", args: [engine.contracts.vault, amount] }));
    await sendOnce("deposit-demo", getAddress(engine.contracts.vault), encodeFunctionData({ abi: emeterVaultAbi, functionName: "deposit", args: [amount] }));
  }
  const ids = published.services.map(item => item.serviceId).sort(), head = await client.getBlock();
  const grant: SessionAuthorization = { customer: operator.address, signer: operator.address, budget, softLimit: 80_000n, maxCharge: 50_000n,
    expiresAt: head.timestamp + 150n, settlementWindow: 60n, serviceSetHash: serviceSetHash(ids), nonce: BigInt(toHex(randomBytes(32))) };
  const signed = await sessions.signSession(await sessions.prepareSession(grant, ids), operator);
  journal.session = { id: signed.sessionId, authorization: jsonSafe(grant), serviceIds: signed.serviceIds, signature: signed.signature, transaction: signed.transaction };
  await save();
}
await sendOnce("create-session", getAddress(journal.session.transaction.to), journal.session.transaction.data);
const sessionId = journal.session.id as Hex;
if (!journal.requests.length) {
  const jsonService = published.services.find(item => item.method === "json_validate")!, aiService = published.services.find(item => item.method === "text_analyze")!;
  const inputs = [
    { service: jsonService, input: { json: '{"name":"emeter","network":"X Layer"}' }, override: false },
    { service: aiService, input: { text: "emeter makes bounded API payments on X Layer. A customer signs a spending limit, a provider returns evidence, and a TapeOut circuit permits settlement." }, override: false },
    { service: jsonService, input: { json: '{"chain":196,"status":"verified"}' }, override: true }
  ];
  for (const input of inputs) {
    const clientId = randomUUID(), id = keccak256(toHex(clientId));
    const version = (await sessions.getQuote(input.service.serviceId)).priceVersion;
    const call: ServiceCall = { id: clientId, method: input.service.method, params: { sessionId, serviceId: input.service.serviceId, priceVersion: version, input: input.input } };
    const signed = await sessions.signCharge(await sessions.prepareCharge({ sessionId, serviceId: input.service.serviceId, priceVersion: version,
      requestId: id, requestHash: requestHash(call), nonce: BigInt(toHex(randomBytes(32))), maxAmount: BigInt(input.service.priceBaseUnits) }), operator);
    const override = input.override ? await sessions.signOverride(signed.authorization, 90_000n, signed.refundAfter, operator) : undefined;
    journal.requests.push({ clientId, requestId: id, serviceId: input.service.serviceId, payload: jsonSafe({ call, authorization: signed.authorization, signature: signed.signature,
      ...(override ? { customerOverride: { ...override.authorization, signature: override.signature } } : {}) }) });
  }
  await save();
}
if (journal.requests.some(request => !request.verified)) {
 const credential = await owner.createApiKey({ sessionId, scopes: ["execute", "request:read"] });
 const sdk = new EmeterClient({ gatewayUrl, rpcUrl: settings.rpc, vault: engine.contracts.vault, registry: engine.contracts.registry, sessionId, token: credential.key });
 for (const request of journal.requests) {
  if (request.verified) continue;
  const response = await fetch(gatewayUrl + "/api/execute/" + request.serviceId, { method: "POST", headers: { authorization: "Bearer " + credential.key, "content-type": "application/json" }, body: canonicalJson(request.payload), signal: AbortSignal.timeout(35_000) });
  if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error("EXECUTION_REFUSED_" + (error.error ?? response.status)); }
  const deadline = Date.now() + 120_000;
  while (true) {
    const result = await sdk.getRequest(request.requestId);
    if (result.paymentStatus === "settled") break;
    if (result.requestStatus === "failed" || result.requestStatus === "indeterminate" || ["failed","denied"].includes(result.paymentStatus))
      throw new Error("REQUEST_NOT_SETTLED_" + (result.error ?? result.paymentStatus));
    if (Date.now() > deadline) throw new Error("REQUEST_PENDING_RETAINED_" + request.requestId);
    await pause(1500);
  }
  const verified = await sdk.verifyRequest(request.requestId);
  assert(verified.receiptVerified && verified.settlementVerified);
  request.verified = true; if (verified.policyInputs !== null) request.policyInputs = verified.policyInputs; request.priceBaseUnits = verified.priceBaseUnits; await save();
  console.log(JSON.stringify({ requestId: request.requestId, receiptVerified: true, settlementVerified: true, priceBaseUnits: verified.priceBaseUnits, policyInputs: verified.policyInputs }));
 }
 await owner.revokeApiKey(credential.id);
}
await sendOnce("close-session", getAddress(engine.contracts.vault), encodeFunctionData({ abi: emeterVaultAbi, functionName: "closeSession", args: [sessionId] }));
await sendOnce("revoke-signer", getAddress(engine.contracts.vault), encodeFunctionData({ abi: emeterVaultAbi, functionName: "revokeSessionSigner", args: [sessionId] }));
const state = await sessions.getSession(sessionId);
while ((await client.getBlock()).timestamp < state.refundAfter) { console.log(JSON.stringify({ waitingForOriginalRefundWindow: true })); await pause(15_000); }
await sendOnce("refund-session", getAddress(engine.contracts.vault), encodeFunctionData({ abi: emeterVaultAbi, functionName: "refund", args: [sessionId] }));
const unused = budget - journal.requests.reduce((sum,item) => sum + BigInt(item.priceBaseUnits!),0n);
// Session refunds transfer directly to the fixed customer. Available credit is
// a separate deposit balance and must not be withdrawn again for this refund.
const refunded = await sessions.getSession(sessionId);
assert.equal(refunded.customer.toLowerCase(), operator.address.toLowerCase());
assert.equal(refunded.status, 3);
assert.equal(refunded.balance, 0n);
assert.equal(refunded.spent, budget - unused);
assert.equal(refunded.refundedAmount, unused);
assert.equal(refunded.signerRevoked, true);
journal.completed = true; await save();
const result = { kind: "convex-mainnet-gateway-activation", chainId: 196, gatewayUrl, operator: operator.address, provider: plan.provider, relayer,
  participantClassification: "builder-controlled operator signs the bounded grant and charges locally", sessionId,
  budgetBaseUnits: budget.toString(), unusedRefundedBaseUnits: unused.toString(), refundDestination: operator.address,
  requests: journal.requests.map(({ requestId, serviceId, policyInputs, priceBaseUnits }) => ({ requestId, serviceId, policyInputs, priceBaseUnits, receiptVerified: true, settlementVerified: true })),
  walletTransactions: journal.steps.map(({ name, to, hash, valueWei, actualCostWei, blockNumber }) => ({ name, to, hash, valueWei, actualCostWei, blockNumber })),
  operatorNativeSpendWei: journal.steps.reduce((sum,item) => sum + BigInt(item.actualCostWei!),0n).toString(), nativeSpendCeilingWei: settings.nativeSpendCap.toString(),
  realAiRequests: 1, fixtureAiRequests: 0, independentAdoption: false, completedAt: new Date().toISOString() };
await writeFile(join(repoRoot, "deployments/xlayer-196-gateway.json"), JSON.stringify(result, null, 2) + "\n");
await writeFile(join(repoRoot, "docs/evidence/convex-mainnet-checks.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ completed: true, mainnetSettledRequests: journal.requests.length, unusedRefundedBaseUnits: unused.toString(), gatewayUrl }));
}
try {
  await main();
  if (process.env.EMETER_ACTIVATION_RESULT_PATH) await writeFile(process.env.EMETER_ACTIVATION_RESULT_PATH, JSON.stringify({ passed: true }) + "\n", { mode: 0o600 });
} catch (error) {
  const message = error instanceof Error ? error.message : "ACTIVATION_INCOMPLETE";
  const code = /^[A-Z0-9_x-]+$/.test(message) ? message : "ACTIVATION_INCOMPLETE";
  if (process.env.EMETER_ACTIVATION_RESULT_PATH) await writeFile(process.env.EMETER_ACTIVATION_RESULT_PATH, JSON.stringify({ passed: false, errorCode: code }) + "\n", { mode: 0o600 });
  console.error(code); process.exitCode = 1;
}
