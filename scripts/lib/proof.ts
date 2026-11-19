import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient,
  decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, http,
  keccak256, parseAbi, toHex
} from "viem";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { POLICY_V1, POLICY_V1_NETLIST_HASH, flagsFromMask, packPolicyInputs, policyDecision } from "@emeter/circuit";
import { chargeAuthorizationTypes, processorAbi, tap13DigestFromHashes, verifyTap13Hashes } from "@emeter/shared";
import { z } from "zod";
import { config, repoRoot, xLayerChain } from "./config.js";

export function createProofClients(rpc: string, account: PrivateKeyAccount) {
  return {
    publicClient: createPublicClient({ chain: xLayerChain, transport: http(rpc, { timeout: 20_000, retryCount: 1 }) }),
    walletClient: createWalletClient({ chain: xLayerChain, account, transport: http(rpc, { timeout: 20_000, retryCount: 1 }) })
  };
}

export function stringify(value: unknown) {
  return JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
}

export async function readArtifact(name: string): Promise<{ abi: Abi; bytecode: Hex; bytecodeSha256: string }> {
  const artifact = JSON.parse(await readFile(join(repoRoot, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as {
    abi: Abi; bytecode: { object: Hex }
  };
  const bytecode = artifact.bytecode.object;
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode)) throw new Error(`Compile ${name} before running the proof`);
  return { abi: artifact.abi, bytecode, bytecodeSha256: createHash("sha256").update(Buffer.from(bytecode.slice(2), "hex")).digest("hex") };
}

export function canonicalProofJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("Invalid proof JSON number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error("Invalid Unicode");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalProofJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(object))) throw new Error("Invalid proof JSON object");
    const keys = Object.keys(object).sort();
    if (keys.some(key => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid proof JSON member");
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalProofJson(object[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported proof JSON value");
}

type Clients = ReturnType<typeof createProofClients>;
type ProofContext = {
  kind: "anvil-fork" | "mainnet";
  clients: Clients;
  customer: PrivateKeyAccount;
  provider: PrivateKeyAccount;
  processor: Address;
  outputPath: string;
  nativeSpendCap: bigint;
  upstreamBlock: string;
  advanceTo?: (timestamp: bigint) => Promise<void>;
};

type ProofStep = {
  label: string; hash: Hex; blockNumber: string; blockHash: Hex;
  status: "success" | "reverted"; from: Address; to: Address | null;
  valueWei: string; gasUsed: string; effectiveGasPrice: string;
  contractAddress: Address | null; dataHash: Hex;
};

export async function runProof(ctx: ProofContext) {
  const cfg = config();
  const { publicClient, walletClient } = ctx.clients;
  if (await publicClient.getChainId() !== 196) throw new Error("Expected chain ID 196");
  const [tokenArtifact, adapterArtifact, vaultArtifact] = await Promise.all([
    readArtifact("DemoUSD"), readArtifact("EmeterPolicyAdapter"), readArtifact("EmeterProofVault")
  ]);
  const steps: ProofStep[] = [];
  const runId = randomUUID();
  const report: Record<string, unknown> = {
    name: "emeter", milestone: "protocol-proof", kind: ctx.kind, chainId: 196,
    runId, createdAt: new Date().toISOString(), upstreamBlock: ctx.upstreamBlock,
    mainnetBroadcastPerformed: false, mainnetProofVerified: false, completed: false,
    customer: ctx.customer.address, providerSigner: ctx.provider.address,
    participantClassification: "builder-controlled proof wallets; not independent adoption",
    serviceClassification: "local schema validation inside the proof runner; paid HTTP gateway not implemented",
    zeroValueDemoToken: true, processor: ctx.processor, factory: cfg.factory, beacon: cfg.beacon,
    netlistHash: POLICY_V1_NETLIST_HASH,
    artifactHashes: { DemoUSD: tokenArtifact.bytecodeSha256, EmeterPolicyAdapter: adapterArtifact.bytecodeSha256, EmeterProofVault: vaultArtifact.bytecodeSha256 },
    steps
  };
  const save = async () => {
    report.updatedAt = new Date().toISOString();
    await mkdir(dirname(ctx.outputPath), { recursive: true });
    await writeFile(ctx.outputPath, stringify(report));
  };
  await save();
  let nativeSpent = 0n;

  async function send(label: string, request: { to?: Address; data: Hex; value?: bigint }, expected: "success" | "reverted" = "success") {
    const value = request.value ?? 0n;
    const estimate = expected === "reverted" ? 400_000n : await publicClient.estimateGas({
      account: ctx.customer.address, ...request, value
    });
    const gas = estimate * 12n / 10n + 10_000n;
    const gasPrice = await publicClient.getGasPrice();
    const block = await publicClient.getBlock();
    if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error("X Layer EIP-1559 base fee is unavailable");
    const quotedBase = block.baseFeePerGas > gasPrice ? block.baseFeePerGas : gasPrice;
    const maxPriorityFeePerGas = quotedBase / 10n || 1n;
    const maxFeePerGas = quotedBase * 2n + maxPriorityFeePerGas;
    if (nativeSpent + value + gas * maxFeePerGas > ctx.nativeSpendCap) throw new Error("Configured native spend cap would be exceeded");
    const balance = await publicClient.getBalance({ address: ctx.customer.address });
    if (balance < value + gas * maxFeePerGas) throw new Error("Deployment wallet needs OKB on X Layer");
    const hash = await walletClient.sendTransaction({ ...request, value, gas, type: "eip1559", maxFeePerGas, maxPriorityFeePerGas });
    if (ctx.kind === "mainnet") report.mainnetBroadcastPerformed = true;
    // Persist a submitted hash before waiting, so a transport failure does not
    // lose evidence of a broadcast or encourage a duplicate transaction.
    report.pendingTransaction = { label, hash, expected, dataHash: keccak256(request.data), valueWei: value.toString() };
    await save();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
    const tx = await publicClient.getTransaction({ hash });
    if (tx.from.toLowerCase() !== ctx.customer.address.toLowerCase() || tx.input !== request.data || tx.value !== value) {
      throw new Error("Mined transaction does not match the submitted proof");
    }
    const step: ProofStep = {
      label, hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      status: receipt.status, from: tx.from, to: tx.to ?? null, valueWei: value.toString(),
      gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      contractAddress: receipt.contractAddress ?? null, dataHash: keccak256(tx.input)
    };
    steps.push(step);
    nativeSpent += value + receipt.gasUsed * receipt.effectiveGasPrice;
    report.nativeSpendWeiExcludingAdditionalL1Fees = nativeSpent.toString();
    delete report.pendingTransaction;
    await save();
    console.log(`${ctx.kind}: ${label} ${hash} ${receipt.status}`);
    if (receipt.status !== expected) throw new Error(`${label} mined with unexpected status`);
    return receipt;
  }

  function requiredAddress(receipt: TransactionReceipt): Address {
    if (!receipt.contractAddress) throw new Error("Deployment receipt has no contract address");
    return getAddress(receipt.contractAddress);
  }

  const transistors = await publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "transistors" });
  const mintAbi = parseAbi([
    "function mint(uint256 id,uint256 amount) payable", "function mintPrice() view returns (uint256)",
    "function protocolFee() view returns (uint256)", "function balanceOf(address,uint256) view returns (uint256)",
    "function BEM() view returns (address)", "function supplyCap() view returns (uint256)", "function minted() view returns (uint256)"
  ]);
  let bemGetter: Address | null = null;
  try { bemGetter = await publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "BEM" }); }
  catch (error) { if (!(error instanceof Error) || !/revert/i.test(error.message)) throw new Error("Could not verify legacy processor fee currency"); }
  if (bemGetter && !/^0x0{40}$/i.test(bemGetter)) throw new Error("This proof runner uses the verified native-fee processor; BEM payment is not configured");
  const [mintPrice, mintFee, heldNand, cap, minted, tapeoutFee] = await Promise.all([
    publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "mintPrice" }),
    publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "protocolFee" }),
    publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "balanceOf", args: [ctx.customer.address, 0n] }),
    publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "supplyCap" }),
    publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "minted" }),
    publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "TAPEOUT_FEE" })
  ]);
  const neededNand = heldNand >= 11n ? 0n : 11n - heldNand;
  if (cap - minted < neededNand) throw new Error("Insufficient remaining transistor supply");
  if (neededNand > 0n) await send("mint-nand", {
    to: transistors, data: encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [0n, neededNand] }),
    value: mintPrice * neededNand + mintFee
  });
  if (await publicClient.readContract({ address: transistors, abi: mintAbi, functionName: "balanceOf", args: [ctx.customer.address, 0n] }) < 11n) {
    throw new Error("NAND mint did not provide enough transistors");
  }
  const publishAbi = parseAbi([
    "function tapeout(bytes nl,uint32 nIn,uint32 nOut) payable returns (uint256)",
    "event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)"
  ]);
  const publication = await send("publish-policy", {
    to: ctx.processor, value: tapeoutFee,
    data: encodeFunctionData({ abi: publishAbi, functionName: "tapeout", args: [POLICY_V1.netlist, 6, 1] })
  });
  let circuitId: bigint | undefined;
  for (const log of publication.logs) {
    if (log.address.toLowerCase() !== ctx.processor.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: publishAbi, data: log.data, topics: log.topics });
      if (event.eventName === "TapedOut" && event.args.author.toLowerCase() === ctx.customer.address.toLowerCase()) circuitId = event.args.circuitId;
    } catch { /* Other processor events are not publication evidence. */ }
  }
  if (circuitId === undefined) throw new Error("Circuit ID must come from a matching TapedOut event");
  const netlist = await publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "netlist", args: [circuitId] });
  if (netlist !== POLICY_V1.netlist) throw new Error("Published netlist differs from generated policy");
  const info = await publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "circuitInfo", args: [circuitId] });
  if (info.join(",") !== "6,1,0,11") throw new Error("Published circuit metadata mismatch");
  report.circuitId = circuitId.toString();
  report.circuitMetadata = info;
  let truthTablePassed = 0;
  for (let start = 0; start < 64; start += 8) {
    const masks = Array.from({ length: 8 }, (_, offset) => start + offset);
    const results = await Promise.all(masks.map(async mask => {
      const flags = flagsFromMask(mask);
      const output = await publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "eval", args: [circuitId!, packPolicyInputs(flags)] });
      if (output !== (policyDecision(flags) ? "0x01" : "0x00")) throw new Error(`Published circuit mismatch for input ${mask}`);
      return true;
    }));
    truthTablePassed += results.length;
  }
  report.truthTablePassed = truthTablePassed;
  await save();

  const demoToken = requiredAddress(await send("deploy-demo-token", {
    data: encodeDeployData({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode, args: [ctx.customer.address] })
  }));
  const adapter = requiredAddress(await send("deploy-adapter", {
    data: encodeDeployData({ abi: adapterArtifact.abi, bytecode: adapterArtifact.bytecode, args: [cfg.factory, ctx.processor, circuitId, cfg.beacon] })
  }));
  const opener = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
  const container = await publicClient.readContract({
    address: opener, abi: parseAbi(["function accountOf(address circuits,uint256 id) view returns (address)"]),
    functionName: "accountOf", args: [ctx.processor, circuitId]
  });
  const head = await publicClient.getBlock();
  const sessionConfig = {
    customer: ctx.customer.address, provider: ctx.provider.address, providerSigner: ctx.provider.address,
    serviceContainer: container, serviceId: keccak256(toHex("emeter-protocol-proof-v1")),
    price: 50_000n, hardBudget: 200_000n, softLimit: 50_000n,
    expiresAt: head.timestamp + 180n, settlementWindow: 120n
  };
  const vault = requiredAddress(await send("deploy-proof-vault", {
    data: encodeDeployData({ abi: vaultArtifact.abi, bytecode: vaultArtifact.bytecode, args: [demoToken, adapter, sessionConfig] })
  }));
  report.contracts = { demoToken, adapter, vault, serviceContainer: container };
  report.configuration = sessionConfig;
  await save();
  const tokenAbi = parseAbi([
    "function mint(address to,uint256 amount)", "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ]);
  await send("mint-demo-balance", { to: demoToken, data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [ctx.customer.address, 1_000_000n] }) });
  await send("approve-demo-vault", { to: demoToken, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [vault, 200_000n] }) });
  await send("fund-demo-session", { to: vault, data: encodeFunctionData({ abi: vaultArtifact.abi, functionName: "deposit", args: [200_000n] }) });

  async function evidence(nonce: bigint, overrideSoftLimit: boolean) {
    const input = { customer: ctx.customer.address, nonce: nonce.toString(), service: "schema-validation" };
    const parsed = z.object({ customer: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nonce: z.string().regex(/^[1-9][0-9]*$/), service: z.literal("schema-validation") }).parse(input);
    const result = { accepted: true, fieldCount: Object.keys(parsed).length, parsed };
    const id = `emeter-proof-${runId}-${nonce}`;
    const canonicalRequest = canonicalProofJson({ method: "validate_json", params: input });
    const canonicalBody = canonicalProofJson(result);
    const now = (await publicClient.getBlock()).timestamp;
    const authorization = {
      requestId: keccak256(toHex(id)), requestHash: keccak256(toHex(canonicalRequest)),
      serviceId: sessionConfig.serviceId, maxAmount: sessionConfig.price, nonce,
      validUntil: sessionConfig.expiresAt + sessionConfig.settlementWindow, overrideSoftLimit
    };
    const receipt = { requestId: authorization.requestId, requestHash: authorization.requestHash,
      bodyHash: keccak256(toHex(canonicalBody)), timestamp: now, ok: true };
    const providerDigestInput = { container, idHash: receipt.requestId, requestHash: receipt.requestHash,
      bodyHash: receipt.bodyHash, ts: receipt.timestamp, ok: true };
    const providerSignature = await ctx.provider.signMessage({ message: { raw: tap13DigestFromHashes(providerDigestInput) } });
    if (!await verifyTap13Hashes(providerDigestInput, providerSignature, ctx.provider.address)) throw new Error("Provider receipt signature failed verification");
    const customerSignature = await ctx.customer.signTypedData({
      domain: { name: "emeter Proof Vault", version: "1", chainId: 196, verifyingContract: vault },
      types: chargeAuthorizationTypes, primaryType: "ChargeAuthorization", message: authorization
    });
    return { id, input, result, canonicalRequest, canonicalBody, authorization, customerSignature, receipt, providerSignature };
  }

  function settlementData(record: Awaited<ReturnType<typeof evidence>>) {
    return encodeFunctionData({ abi: vaultArtifact.abi, functionName: "settle", args: [record.authorization, record.customerSignature, record.receipt, record.providerSignature] });
  }
  async function balances() {
    const [customer, provider, vaultTokens, tracked, spent] = await Promise.all([
      publicClient.readContract({ address: demoToken, abi: tokenAbi, functionName: "balanceOf", args: [ctx.customer.address] }),
      publicClient.readContract({ address: demoToken, abi: tokenAbi, functionName: "balanceOf", args: [ctx.provider.address] }),
      publicClient.readContract({ address: demoToken, abi: tokenAbi, functionName: "balanceOf", args: [vault] }),
      publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "balance" }) as Promise<bigint>,
      publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "spent" }) as Promise<bigint>
    ]);
    return { customer, provider, vaultTokens, tracked, spent };
  }

  const first = await evidence(1n, false);
  report.allowedCharge = first;
  await save();
  await send("settle-allowed-request", { to: vault, data: settlementData(first) });
  const afterFirst = await balances();
  if (afterFirst.provider !== 50_000n || afterFirst.spent !== 50_000n || afterFirst.tracked !== 150_000n) throw new Error("Allowed settlement balances mismatch");
  report.afterAllowed = afterFirst;

  const denied = await evidence(2n, false);
  report.deniedCharge = denied;
  const args = [denied.authorization, denied.customerSignature, denied.receipt, denied.providerSignature] as const;
  let denialVerified = false;
  try { await publicClient.simulateContract({ address: vault, abi: vaultArtifact.abi, functionName: "settle", args, account: ctx.customer.address }); }
  catch (error) {
    if (error instanceof BaseError) {
      const reverted = error.walk(item => item instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === "PolicyDenied" && Number(reverted.data.args?.[0]) === 15) denialVerified = true;
    }
  }
  if (!denialVerified) throw new Error("Expected authenticated PolicyDenied(15) simulation");
  const actualOutput = await publicClient.readContract({ address: ctx.processor, abi: processorAbi, functionName: "eval", args: [circuitId, "0x0f"] });
  if (actualOutput !== "0x00") throw new Error("Circuit must deny the soft-limit attempt");
  await send("deny-soft-limit-request", { to: vault, data: settlementData(denied) }, "reverted");
  const afterDenied = await balances();
  if (stringify(afterFirst) !== stringify(afterDenied)) throw new Error("Denied transaction changed DemoUSD balances");
  report.denial = { policyInputs: "0x0f", circuitOutput: actualOutput, simulatedError: "PolicyDenied(15)", actualTransactionReverted: true, balancesUnchanged: true };

  const overridden = { ...denied, authorization: { ...denied.authorization, overrideSoftLimit: true } };
  overridden.customerSignature = await ctx.customer.signTypedData({
    domain: { name: "emeter Proof Vault", version: "1", chainId: 196, verifyingContract: vault },
    types: chargeAuthorizationTypes, primaryType: "ChargeAuthorization", message: overridden.authorization
  });
  report.overrideCharge = overridden;
  await send("settle-signed-override", { to: vault, data: settlementData(overridden) });
  const afterOverride = await balances();
  if (afterOverride.provider !== 100_000n || afterOverride.tracked !== 100_000n || afterOverride.spent !== 100_000n) throw new Error("Signed override balances mismatch");
  report.afterOverride = afterOverride;
  await save();

  const refundAfter = sessionConfig.expiresAt + sessionConfig.settlementWindow;
  if (ctx.advanceTo) await ctx.advanceTo(refundAfter + 1n);
  else {
    let lastUpdate = 0;
    while ((await publicClient.getBlock()).timestamp < refundAfter) {
      if (Date.now() - lastUpdate > 15_000) { console.log(`mainnet: waiting for locked settlement window to end at ${refundAfter}`); lastUpdate = Date.now(); }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
  await send("refund-unused-demo-balance", { to: vault, data: encodeFunctionData({ abi: vaultArtifact.abi, functionName: "refund" }) });
  const finalBalances = await balances();
  if (finalBalances.customer !== 900_000n || finalBalances.provider !== 100_000n || finalBalances.vaultTokens !== 0n || finalBalances.tracked !== 0n) throw new Error("Refund did not conserve DemoUSD balances");
  report.finalBalances = finalBalances;
  report.completed = true;
  report.mainnetProofVerified = ctx.kind === "mainnet";
  report.confirmationLevel = "mined receipts, one confirmation; not an L1-finality assertion";
  await save();
  console.log(stringify({ kind: ctx.kind, completed: true, processor: ctx.processor, circuitId: circuitId.toString(), contracts: report.contracts, truthTablePassed, transactions: steps.length, nativeSpendWeiExcludingAdditionalL1Fees: nativeSpent.toString(), mainnetProofVerified: report.mainnetProofVerified, output: ctx.outputPath }));
  return report;
}
