import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BaseError, ContractFunctionRevertedError, encodeDeployData, encodeFunctionData,
  hashTypedData, keccak256, parseAbi, toHex } from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { EmeterSessionClient } from "@emeter/sdk";
import { emeterRegistryAbi, emeterVaultAbi, overrideSigningPayload, serviceSetHash,
  tap13DigestFromHashes, verifyTap13Hashes, ZERO_BYTES32 } from "@emeter/shared";
import { canonicalProofJson, createProofClients, readArtifact, stringify } from "./proof.js";

export type EngineProofContext = {
  kind: "anvil-fork" | "mainnet";
  rpc: string;
  clients: ReturnType<typeof createProofClients>;
  operator: PrivateKeyAccount;
  secondCustomer: PrivateKeyAccount;
  token: Address;
  adapter: Address;
  container: Address;
  outputPath: string;
  nativeSpendCap: bigint;
  upstreamBlock: string;
  advanceTo?: (timestamp: bigint) => Promise<void>;
};

export async function runEngineProof(ctx: EngineProofContext) {
  const { publicClient, walletClient } = ctx.clients;
  if (await publicClient.getChainId() !== 196) throw new Error("Expected X Layer chain 196");
  const [registryArtifact, vaultArtifact] = await Promise.all([readArtifact("EmeterRegistry"), readArtifact("EmeterVault")]);
  const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
  const before = await Promise.all([ctx.operator.address, ctx.secondCustomer.address].map(address => publicClient.readContract({
    address: ctx.token, abi: tokenAbi, functionName: "balanceOf", args: [address]
  })));
  if (before[0]! < 400_000n) throw new Error("The operator needs 0.40 zero-value DEMO for the two-session proof");
  const nativeBefore = await publicClient.getBalance({ address: ctx.operator.address });
  const runId = randomUUID();
  const steps: Record<string, unknown>[] = [];
  const report: Record<string, unknown> = {
    name: "emeter", phase: "payment-engine", kind: ctx.kind, runId,
    createdAt: new Date().toISOString(), chainId: 196, upstreamBlock: ctx.upstreamBlock,
    completed: false, mainnetBroadcastPerformed: false, mainnetProofVerified: false,
    operator: ctx.operator.address, secondCustomer: ctx.secondCustomer.address,
    participantClassification: "builder-controlled wallets, not independent adoption",
    workloadClassification: "two actual local computations; paid HTTP gateway not implemented",
    token: ctx.token, adapter: ctx.adapter, container: ctx.container,
    tokenBalancesBefore: { operator: before[0], secondCustomer: before[1] },
    nativeBalanceBefore: nativeBefore, nativeSpendCap: ctx.nativeSpendCap,
    artifactHashes: { registry: registryArtifact.bytecodeSha256, vault: vaultArtifact.bytecodeSha256 }, steps
  };
  const save = async () => {
    report.updatedAt = new Date().toISOString();
    await mkdir(dirname(ctx.outputPath), { recursive: true });
    await writeFile(ctx.outputPath, stringify(report));
  };
  await save();
  let nativeSpent = 0n;

  async function send(label: string, data: Hex, to?: Address, expected: "success" | "reverted" = "success") {
    const estimated = expected === "reverted" ? 400_000n : await publicClient.estimateGas({
      account: ctx.operator.address, data, ...(to ? { to } : {})
    });
    const gas = estimated * 12n / 10n + 10_000n;
    const [gasPrice, block] = await Promise.all([publicClient.getGasPrice(), publicClient.getBlock()]);
    if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error("Missing X Layer base fee");
    const base = block.baseFeePerGas > gasPrice ? block.baseFeePerGas : gasPrice;
    const maxPriorityFeePerGas = base / 10n || 1n;
    const maxFeePerGas = base * 2n + maxPriorityFeePerGas;
    if (nativeSpent + gas * maxFeePerGas > ctx.nativeSpendCap) throw new Error("Payment-engine proof would exceed the native spend cap");
    if (await publicClient.getBalance({ address: ctx.operator.address }) < gas * maxFeePerGas) throw new Error("Operator needs more OKB for gas");
    const hash = await walletClient.sendTransaction({ data, ...(to ? { to } : {}), gas,
      type: "eip1559", maxFeePerGas, maxPriorityFeePerGas });
    if (ctx.kind === "mainnet") report.mainnetBroadcastPerformed = true;
    report.pendingTransaction = { label, hash, expected, dataHash: keccak256(data) };
    await save();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
    const tx = await publicClient.getTransaction({ hash });
    if (tx.input !== data || tx.from.toLowerCase() !== ctx.operator.address.toLowerCase() || tx.value !== 0n) throw new Error("Engine transaction does not match submitted calldata");
    steps.push({ label, hash, status: receipt.status, blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash, from: tx.from, to: tx.to, dataHash: keccak256(tx.input),
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, contractAddress: receipt.contractAddress });
    nativeSpent += receipt.gasUsed * receipt.effectiveGasPrice;
    report.nativeSpendWei = nativeSpent;
    delete report.pendingTransaction;
    await save();
    console.log(`${ctx.kind}: ${label} ${hash} ${receipt.status}`);
    if (receipt.status !== expected) throw new Error(`${label} has unexpected mined status`);
    return receipt;
  }

  const registryReceipt = await send("deploy-registry", encodeDeployData({
    abi: registryArtifact.abi, bytecode: registryArtifact.bytecode, args: [ctx.operator.address]
  }));
  if (!registryReceipt.contractAddress) throw new Error("Registry deployment has no address");
  const registry = registryReceipt.contractAddress;
  const vaultReceipt = await send("deploy-session-vault", encodeDeployData({
    abi: vaultArtifact.abi, bytecode: vaultArtifact.bytecode, args: [ctx.token, registry, ctx.adapter]
  }));
  if (!vaultReceipt.contractAddress) throw new Error("Session-vault deployment has no address");
  const vault = vaultReceipt.contractAddress;
  report.contracts = { registry, vault };
  await save();
  const sdk = new EmeterSessionClient({ rpcUrl: ctx.rpc, vault, registry });
  const serviceA = keccak256(toHex("emeter-engine-json-validator"));
  const serviceB = keccak256(toHex("emeter-engine-word-count"));
  const metadataA = { name: "JSON Validator engine proof", method: "json_validate", execution: "local", priceBaseUnits: "20000" };
  const metadataB = { name: "Word Count engine proof", method: "word_count", execution: "local", priceBaseUnits: "50000" };
  const metadataANext = { ...metadataA, priceBaseUnits: "30000" };
  const metadataHashA = keccak256(toHex(canonicalProofJson(metadataA)));
  const metadataHashB = keccak256(toHex(canonicalProofJson(metadataB)));
  const metadataHashANext = keccak256(toHex(canonicalProofJson(metadataANext)));
  report.services = { serviceA, serviceB, metadataA, metadataB, metadataANext, metadataHashA, metadataHashB, metadataHashANext };
  await send("allow-provider", encodeFunctionData({ abi: emeterRegistryAbi, functionName: "setProviderAllowed", args: [ctx.operator.address, true] }), registry);
  await send("register-json-validator-v1", encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService",
    args: [serviceA, ctx.secondCustomer.address, ctx.secondCustomer.address, ctx.container, 20_000n, metadataHashA] }), registry);
  await send("register-word-count-v1", encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService",
    args: [serviceB, ctx.secondCustomer.address, ctx.secondCustomer.address, ctx.container, 50_000n, metadataHashB] }), registry);
  await send("approve-prepaid-deposit", encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [vault, 400_000n] }), ctx.token);
  await send("deposit-customer-one", encodeFunctionData({ abi: emeterVaultAbi, functionName: "deposit", args: [200_000n] }), vault);
  await send("sponsor-customer-two", encodeFunctionData({ abi: emeterVaultAbi, functionName: "depositFor", args: [ctx.secondCustomer.address, 200_000n] }), vault);

  // Delegated keys exist only in process memory and are never serialized.
  const delegate = privateKeyToAccount(generatePrivateKey());
  const delegateTwo = privateKeyToAccount(generatePrivateKey());
  const head = await publicClient.getBlock();
  const expiresAt = head.timestamp + 240n;
  const settlementWindow = 120n;
  const grantOne = { customer: ctx.operator.address, signer: delegate.address, budget: 200_000n,
    softLimit: 50_000n, maxCharge: 50_000n, expiresAt, settlementWindow,
    serviceSetHash: serviceSetHash([serviceA, serviceB]), nonce: 0n };
  const grantTwo = { ...grantOne, customer: ctx.secondCustomer.address, signer: delegateTwo.address,
    serviceSetHash: serviceSetHash([serviceA]) };
  const preparedOne = await sdk.prepareSession(grantOne, [serviceA, serviceB]);
  const preparedTwo = await sdk.prepareSession(grantTwo, [serviceA]);
  const [signedOne, signedTwo] = await Promise.all([sdk.signSession(preparedOne, ctx.operator), sdk.signSession(preparedTwo, ctx.secondCustomer)]);
  for (const prepared of [signedOne, signedTwo]) {
    const contractDigest = await publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "sessionAuthorizationDigest", args: [prepared.authorization] });
    if (contractDigest !== hashTypedData(prepared.typedData)) throw new Error("SDK customer grant digest disagrees with the vault");
  }
  report.sessions = { first: signedOne, second: signedTwo };
  await save();
  await send("create-customer-one-session", signedOne.transaction.data, vault);
  await send("create-customer-two-session", signedTwo.transaction.data, vault);
  const sessionOne = preparedOne.sessionId;
  const sessionTwo = preparedTwo.sessionId;

  function request(sessionId: Hex, serviceId: Hex, priceVersion: number, nonce: number) {
    const id = `engine-${runId}-${sessionId.slice(2, 10)}-${nonce}`;
    const method = serviceId === serviceA ? "json_validate" : "word_count";
    const input = serviceId === serviceA
      ? { kind: "engine-proof", sequence: nonce, message: "An actual bounded service request" }
      : { text: "Meter every request and enforce every spending limit." };
    const canonicalRequest = canonicalProofJson({ method, params: { sessionId, serviceId, priceVersion, input } });
    return { id, input, method, canonicalRequest, requestId: keccak256(toHex(id)), requestHash: keccak256(toHex(canonicalRequest)) };
  }

  const firstRequest = request(sessionOne, serviceA, 1, 1);
  const firstPrepared = await sdk.prepareCharge({ sessionId: sessionOne, serviceId: serviceA, priceVersion: 1,
    requestId: firstRequest.requestId, requestHash: firstRequest.requestHash, nonce: 1n });
  const firstSigned = await sdk.signCharge(firstPrepared, delegate);
  if (firstSigned.quote.price !== 20_000n) throw new Error("Original quote is not version-one price");
  await send("publish-json-price-v2", encodeFunctionData({ abi: emeterRegistryAbi, functionName: "publishPriceVersion",
    args: [serviceA, ctx.secondCustomer.address, ctx.secondCustomer.address, ctx.container, 30_000n, metadataHashANext] }), registry);
  if ((await sdk.getQuote(serviceA)).price !== 30_000n) throw new Error("New price version did not become available");

  type SignedCharge = Awaited<ReturnType<EmeterSessionClient["signCharge"]>>;
  async function evidence(signed: SignedCharge, req: ReturnType<typeof request>) {
    // These are actual computations, not static API answers or an AI claim.
    let result: unknown;
    if (req.method === "json_validate") {
      const parsed = z.object({ kind: z.literal("engine-proof"), sequence: z.number().int(), message: z.string().min(1) }).parse(req.input);
      result = { valid: true, fields: Object.keys(parsed).length, parsed };
    } else {
      const parsed = z.object({ text: z.string().min(1) }).parse(req.input);
      result = { words: parsed.text.trim().split(/\s+/u).length, characters: Array.from(parsed.text).length };
    }
    const bodyHash = keccak256(toHex(canonicalProofJson(result)));
    const timestamp = (await publicClient.getBlock()).timestamp;
    const receipt = { requestId: req.requestId, requestHash: req.requestHash, bodyHash, timestamp, ok: true };
    const hashInput = { container: ctx.container, idHash: req.requestId, requestHash: req.requestHash, bodyHash, ts: timestamp, ok: true };
    const providerSignature = await ctx.secondCustomer.signMessage({ message: { raw: tap13DigestFromHashes(hashInput) } });
    if (!await verifyTap13Hashes(hashInput, providerSignature, ctx.secondCustomer.address)) throw new Error("Provider receipt verification failed");
    const digest = await publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "chargeAuthorizationDigest", args: [signed.authorization] });
    if (digest !== hashTypedData(signed.typedData)) throw new Error("SDK charge digest disagrees with the vault");
    return { request: req, result, settlement: { authorization: signed.authorization, chargeSignature: signed.signature,
      receipt, providerSignature, softLimitOverride: { sessionId: ZERO_BYTES32, chargeDigest: ZERO_BYTES32,
        maxTotalSpend: 0n, validUntil: 0n }, customerOverrideSignature: "0x" as Hex } };
  }
  type Settlement = Awaited<ReturnType<typeof evidence>>["settlement"];
  const settleData = (value: Settlement) => encodeFunctionData({ abi: emeterVaultAbi, functionName: "settle", args: [value] });

  const firstEvidence = await evidence(firstSigned, firstRequest);
  report.oldPriceCharge = { quotedBeforePriceUpdate: firstSigned.quote.price, ...firstEvidence };
  await save();
  await send("settle-pinned-version-one", settleData(firstEvidence.settlement), vault);
  if ((await sdk.getSession(sessionOne)).spent !== 20_000n) throw new Error("Old price quote was not honored");

  const secondRequest = request(sessionOne, serviceB, 1, 2);
  const secondPrepared = await sdk.prepareCharge({ sessionId: sessionOne, serviceId: serviceB, priceVersion: 1,
    requestId: secondRequest.requestId, requestHash: secondRequest.requestHash, nonce: 2n });
  if (!secondPrepared.requiresCustomerOverride) throw new Error("Second charge should exceed soft limit");
  const secondSigned = await sdk.signCharge(secondPrepared, delegate);
  const secondEvidence = await evidence(secondSigned, secondRequest);
  const currentSession = await sdk.getSession(sessionOne);
  const ownerGrant = { sessionId: sessionOne, chargeDigest: hashTypedData(secondSigned.typedData),
    maxTotalSpend: 70_000n, validUntil: currentSession.refundAfter };
  const forgedSignature = await delegate.signTypedData(overrideSigningPayload(vault, ownerGrant));
  const forged = { ...secondEvidence.settlement, softLimitOverride: ownerGrant, customerOverrideSignature: forgedSignature };
  report.delegatedSelfOverrideAttempt = { ...secondEvidence, settlement: forged };
  const preview = await publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "previewSettlement", args: [forged] });
  if (preview[1] !== 15 || preview[2] !== false) throw new Error("Delegated key must not authorize its own soft-limit override");
  let expectedDenial = false;
  try { await publicClient.simulateContract({ address: vault, abi: emeterVaultAbi, functionName: "settle", args: [forged], account: ctx.operator.address }); }
  catch (error) {
    if (error instanceof BaseError) {
      const reverted = error.walk(item => item instanceof ContractFunctionRevertedError);
      expectedDenial = reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === "PolicyDenied" && Number(reverted.data.args?.[0]) === 15;
    }
  }
  if (!expectedDenial) throw new Error("Expected authenticated PolicyDenied(15) for delegated self-override");
  await send("deny-delegate-self-override", settleData(forged), vault, "reverted");
  if ((await sdk.getSession(sessionOne)).spent !== 20_000n) throw new Error("Denied charge changed the session spending");
  const ownerOverride = await sdk.signOverride(secondSigned.authorization, 70_000n, currentSession.refundAfter, ctx.operator);
  const overridden = { ...secondEvidence.settlement, softLimitOverride: ownerOverride.authorization, customerOverrideSignature: ownerOverride.signature };
  report.customerOverrideCharge = { ...secondEvidence, settlement: overridden };
  await send("settle-customer-authorized-override", settleData(overridden), vault);
  if ((await sdk.getSession(sessionOne)).spent !== 70_000n) throw new Error("Owner override spending mismatch");

  const thirdRequest = request(sessionTwo, serviceA, 2, 1);
  const thirdSigned = await sdk.signCharge(await sdk.prepareCharge({ sessionId: sessionTwo, serviceId: serviceA,
    priceVersion: 2, requestId: thirdRequest.requestId, requestHash: thirdRequest.requestHash, nonce: 1n }), delegateTwo);
  const thirdEvidence = await evidence(thirdSigned, thirdRequest);
  report.secondCustomerCharge = thirdEvidence;
  await send("settle-customer-two-version-two", settleData(thirdEvidence.settlement), vault);
  if ((await sdk.getSession(sessionTwo)).spent !== 30_000n) throw new Error("Second customer was not charged version-two price");
  await send("close-customer-one-session", encodeFunctionData({ abi: emeterVaultAbi, functionName: "closeSession", args: [sessionOne] }), vault);
  if ((await sdk.getSession(sessionOne)).refundAfter !== currentSession.refundAfter) throw new Error("Early closing shortened the refund deadline");
  const refundAfter = (await sdk.getSession(sessionTwo)).refundAfter;
  if (ctx.advanceTo) await ctx.advanceTo(refundAfter + 1n);
  else {
    let updated = 0;
    while ((await publicClient.getBlock()).timestamp < refundAfter) {
      if (Date.now() - updated > 15_000) { console.log(`mainnet: waiting for both original settlement windows to end at ${refundAfter}`); updated = Date.now(); }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
  await send("refund-customer-one", encodeFunctionData({ abi: emeterVaultAbi, functionName: "refund", args: [sessionOne] }), vault);
  await send("refund-customer-two", encodeFunctionData({ abi: emeterVaultAbi, functionName: "refund", args: [sessionTwo] }), vault);
  const [finalOne, finalTwo, finalOperator, finalSecond, held, available, locked, paid] = await Promise.all([
    sdk.getSession(sessionOne), sdk.getSession(sessionTwo),
    publicClient.readContract({ address: ctx.token, abi: tokenAbi, functionName: "balanceOf", args: [ctx.operator.address] }),
    publicClient.readContract({ address: ctx.token, abi: tokenAbi, functionName: "balanceOf", args: [ctx.secondCustomer.address] }),
    publicClient.readContract({ address: ctx.token, abi: tokenAbi, functionName: "balanceOf", args: [vault] }),
    publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "totalAvailable" }),
    publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "totalLocked" }),
    publicClient.readContract({ address: vault, abi: emeterVaultAbi, functionName: "totalPaid" })
  ]);
  if (finalOne.refundedAmount !== 130_000n || finalTwo.refundedAmount !== 170_000n
    || finalOne.status !== 3 || finalTwo.status !== 3 || held !== 0n || available !== 0n || locked !== 0n || paid !== 100_000n
    || finalOperator !== before[0]! - 270_000n || finalSecond !== before[1]! + 270_000n) throw new Error("Engine refund and token conservation mismatch");
  report.finalSessions = { first: finalOne, second: finalTwo };
  report.tokenBalancesAfter = { operator: finalOperator, secondCustomer: finalSecond, vault: held };
  report.totals = { available, locked, paid };
  report.nativeBalanceAfter = await publicClient.getBalance({ address: ctx.operator.address });
  report.completed = true;
  report.mainnetProofVerified = ctx.kind === "mainnet";
  await save();
  console.log(stringify({ kind: ctx.kind, completed: true, contracts: report.contracts,
    token: ctx.token, adapter: ctx.adapter, totalPaid: paid, transactions: steps.length,
    nativeSpendWei: nativeSpent, output: ctx.outputPath }));
  return report;
}
