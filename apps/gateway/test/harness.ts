import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PostgresPool } from "@emeter/database";
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, encodeDeployData, encodeAbiParameters, http, keccak256, parseAbi, toHex } from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { EmeterClient } from "@emeter/sdk";
import { canonicalJson, emeterRegistryAbi, emeterVaultAbi, jsonSafe, serviceSetHash, signTap13, usageAmount, X_LAYER_USDC } from "@emeter/shared";
import { readArtifact } from "../../../scripts/lib/proof.js";
import type { JsonValue, ServiceManifest } from "@emeter/shared";
import { buildGateway } from "../src/app.js";
import { createAnalyzer } from "../src/ai.js";
import type { Analyzer } from "../src/ai.js";
import type { GatewayConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { builtInServices, buildProvider } from "../src/providers.js";
import { startWorkers } from "../src/worker.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("No available test port");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return bound.port;
}

export async function createGatewayHarness(options: { browserOrigins?: string[]; registerServices?: boolean; usdc?: boolean } = {}) {
  let stage = "fork source";
  const original = JSON.parse(await readFile(join(root, "deployments/xlayer-196.json"), "utf8"));
  const engine = JSON.parse(await readFile(join(root, "deployments/xlayer-196-engine.json"), "utf8"));
  const upstreamRpc = process.env.EMETER_TEST_FORK_RPC ?? "https://xlayer.drpc.org";
  const upstream = createPublicClient({ transport: http(upstreamRpc, { timeout: 20_000, retryCount: 1 }) });
  if (await upstream.getChainId() !== 196) throw new Error("Fork source must be X Layer");
  // Built-in IDs are now registered in production with dedicated signers.
  // Reproduce fixtures from the completed engine proof, before those terms
  // exist, so a temporary provider can register its own immutable manifests.
  const baseline = engine.steps.at(-1);
  const requestedBlock = process.env.EMETER_TEST_FORK_BLOCK;
  if (requestedBlock && !/^[1-9][0-9]{0,17}$/.test(requestedBlock)) throw new Error("Invalid test fork block");
  const forkBlock = BigInt(requestedBlock ?? baseline.blockNumber);
  const sourceBlock = await upstream.getBlock({ blockNumber: forkBlock });
  if (!requestedBlock && sourceBlock.hash.toLowerCase() !== baseline.blockHash.toLowerCase())
    throw new Error("Fork source differs from the recorded engine proof block");
  const [forkPort, gatewayPort, providerPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const rpc = "http://127.0.0.1:" + forkPort;
  const child = spawn(process.env.EMETER_ANVIL_BINARY ?? join(homedir(), ".foundry/bin/anvil"), [
    "--fork-url", upstreamRpc, "--fork-block-number", forkBlock.toString(), "--chain-id", "196",
    "--host", "127.0.0.1", "--port", String(forkPort), "--block-time", "1", "--silent"
  ], { stdio: "ignore" });
  let childStopped = false;
  child.once("error", () => { childStopped = true; }); child.once("exit", () => { childStopped = true; });
  const admin = new PostgresPool({ connectionString: process.env.EMETER_TEST_POSTGRES_URL ?? "postgresql://emeter@127.0.0.1:55432/postgres" });
  const databaseName = "emeter_gateway_test_" + randomBytes(8).toString("hex");
  const databaseUrl = new URL(process.env.EMETER_TEST_POSTGRES_URL ?? "postgresql://emeter@127.0.0.1:55432/postgres");
  databaseUrl.pathname = "/" + databaseName;
  let created = false;
  const cleanup: (() => Promise<void>)[] = [];
  const close = async () => {
    for (const action of cleanup.reverse()) { try { await action(); } catch { /* Still clean the isolated database and Anvil. */ } }
    try { if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)'); }
    finally { child.kill("SIGTERM"); await admin.end(); }
  };
  try {
    stage = "Anvil startup";
    for (let n = 0; n < 100; n++) {
      if (childStopped) throw new Error("The isolated Anvil fork could not start");
      try { if (await createPublicClient({ transport: http(rpc, { timeout: 500, retryCount: 0 }) }).getChainId() === 196) break; }
      catch { if (n === 99) throw new Error("Anvil startup timed out"); await pause(200); }
    }
    stage = "isolated PostgreSQL migrations";
    await admin.query('CREATE DATABASE "' + databaseName + '"'); created = true;
    const migrationDb = new PostgresPool({ connectionString: databaseUrl.href });
    try {
      const directory = join(root, "packages/database/prisma/migrations");
      for (const name of (await readdir(directory)).filter(name => /^[0-9]/.test(name)).sort())
        await migrationDb.query(await readFile(join(directory, name, "migration.sql"), "utf8"));
    } finally { await migrationDb.end(); }
    const relayer = privateKeyToAccount(generatePrivateKey());
    const providerAccount = privateKeyToAccount(generatePrivateKey());
    let vaultAddress = engine.contracts.vault as Address;
    if (options.usdc) {
      stage = "local USDC vault deployment";
      const test = createTestClient({ mode: "anvil", transport: http(rpc) });
      await test.setBalance({ address: relayer.address, value: 10_000_000_000_000_000_000n });
      const artifact = await readArtifact("EmeterVault");
      const hash = await createWalletClient({ account: relayer, transport: http(rpc) }).sendTransaction({ chain: null,
        data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode,
          args: [X_LAYER_USDC.address, engine.contracts.registry, original.contracts.adapter] }) });
      const receipt = await createPublicClient({ transport: http(rpc) }).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Local USDC vault deployment failed");
      vaultAddress = receipt.contractAddress;
    }
    const cfg: GatewayConfig = {
      databaseUrl: databaseUrl.href, redisUrl: process.env.EMETER_TEST_REDIS_URL ?? "redis://127.0.0.1:56379/0", rpcUrl: rpc,
      chainId: 196, vault: vaultAddress, registry: engine.contracts.registry,
      token: options.usdc ? X_LAYER_USDC.address : original.contracts.demoToken, adapter: original.contracts.adapter,
      deployer: relayer.address, providerSigner: providerAccount.address, container: original.contracts.serviceContainer,
      deploymentBlock: forkBlock + 1n, gatewayOrigin: "http://127.0.0.1:" + gatewayPort,
      providerOrigin: "http://127.0.0.1:" + providerPort, allowedProviderOrigins: ["http://127.0.0.1:" + providerPort],
      dispatchSecret: randomBytes(32).toString("hex"), confirmations: 1, queuePrefix: "emeter-test-" + randomBytes(8).toString("hex"),
      settlementGasBudget: 10_000_000_000_000_000n, executionTimeoutMs: 28_000, networkMode: "local-fork",
      browserOrigins: options.browserOrigins ?? []
    };
    const ctx = createContext(cfg);
    cleanup.push(ctx.close);
    cleanup.push(async () => { await ctx.executionQueue.obliterate({ force: true }); await ctx.settlementQueue.obliterate({ force: true }); });
    const chain = ctx.chain;
    const client = createPublicClient({ chain, pollingInterval: 100, transport: http(rpc) });
    const test = createTestClient({ chain, mode: "anvil", transport: http(rpc) });
    // Historical state must use the provider's current receipt clock for new
    // fixture activity. The recorded source block itself remains unchanged.
    const wallClock = BigInt(Math.floor(Date.now() / 1000));
    if ((await client.getBlock()).timestamp < wallClock - 5n) {
      await test.setNextBlockTimestamp({ timestamp: wallClock + 1n });
      await test.mine({ blocks: 1 });
    }
    stage = "local provider allowlist transaction";
    for (const address of [relayer.address, providerAccount.address, original.customer])
      await test.setBalance({ address, value: 10_000_000_000_000_000_000n });
    await test.impersonateAccount({ address: original.customer });
    const send = async (account: PrivateKeyAccount | Address, to: Address, data: Hex) => {
      const wallet = createWalletClient({ chain, account, transport: http(rpc) });
      const hash = await wallet.sendTransaction({ to, data, value: 0n });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Test fixture transaction reverted");
      return receipt;
    };
    let balanceSlot: bigint | undefined;
    const fundPaymentToken = async (address: Address, amount: bigint) => {
      if (!options.usdc) return send(original.customer, cfg.token, encodeFunctionData({
        abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [address, amount] }));
      // Storage funding is restricted to this generated local Anvil endpoint.
      // Actual USDC code still handles all approvals, transfers and refunds.
      if (new URL(rpc).hostname !== "127.0.0.1") throw new Error("FIXTURE_FUNDING_REQUIRES_LOCAL_RPC");
      const abi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
      const slotFor = (slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, slot]));
      if (balanceSlot === undefined) {
        const marker = 1_234_567_891_011n;
        for (let slot = 0n; slot < 128n; slot++) {
          const index = slotFor(slot), previous = await client.getStorageAt({ address: cfg.token, slot: index });
          try {
            await test.setStorageAt({ address: cfg.token, index, value: toHex(marker, { size: 32 }) });
            if (await client.readContract({ address: cfg.token, abi, functionName: "balanceOf", args: [address] }) === marker) balanceSlot = slot;
          } finally { await test.setStorageAt({ address: cfg.token, index, value: previous ?? toHex(0n, { size: 32 }) }); }
          if (balanceSlot !== undefined) break;
        }
      }
      if (balanceSlot === undefined) throw new Error("USDC_BALANCE_STORAGE_NOT_FOUND");
      const previous = await client.readContract({ address: cfg.token, abi, functionName: "balanceOf", args: [address] });
      await test.setStorageAt({ address: cfg.token, index: slotFor(balanceSlot), value: toHex(previous + amount, { size: 32 }) });
      if (await client.readContract({ address: cfg.token, abi, functionName: "balanceOf", args: [address] }) !== previous + amount)
        throw new Error("USDC_FIXTURE_FUNDING_FAILED");
    };
    await send(original.customer, cfg.registry, encodeFunctionData({ abi: emeterRegistryAbi,
      functionName: "setProviderAllowed", args: [providerAccount.address, true] }));
    const counters = { fixtureAi: 0, liveAi: 0 };
    const fixture: Analyzer = { model: "offline-fixture-model", runtime: "offline-fixture", analyze: async text => {
      counters.fixtureAi++;
      const analysis = { summary: "Controlled fixture output.", sentiment: "neutral", topics: ["fixture"] };
      const request = JSON.stringify({ model: "offline-fixture-model", max_tokens: 1024, messages: [{ role: "user", content: text }] });
      const response = JSON.stringify({ id: randomUUID(), model: "offline-fixture-model", type: "message", stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(analysis) }], usage: { input_tokens: 10, output_tokens: 14 } });
      const body = JSON.parse(response);
      const params = { path: "/v1/messages", requestSha256: createHash("sha256").update(request).digest("hex") };
      const usage = { prompt_tokens: 10, completion_tokens: 14, total_tokens: 24 };
      const price = { currency: "USD" as const, unit: "1M tokens" as const, input: "0.1", output: "0.2" };
      const result = { model: body.model, usage, responseSha256: createHash("sha256").update(response).digest("hex"),
        stream: false, complete: true, status: 200, prices: [{ currency: "USD", amount: usageAmount(usage, price) }], modelMatchedBy: "response" };
      const envelope = await signTap13({ id: body.id, method: "anthropic_messages", params }, cfg.container, jsonSafe(result), true,
        Math.floor(Date.now() / 1000), providerAccount.signMessage);
      return jsonSafe({ analysis, model: { id: body.model, runtime: "offline-fixture" }, usageEvidence: {
        receipt: { id: body.id, ok: true, container: cfg.container, ts: envelope.ts, method: "anthropic_messages", params, result, sig: envelope.sig },
        requestBodyBase64: Buffer.from(request).toString("base64"), responseBodyBase64: Buffer.from(response).toString("base64"),
        status: 200, format: "anthropic-messages", priceTable: [price], priceModel: body.model
      } });
    } };
    let activeAnalyzer = fixture;
    const routed: Analyzer = { model: fixture.model, runtime: "offline-fixture", analyze: text => activeAnalyzer.analyze(text) };
    stage = "provider and gateway HTTP startup";
    let provider = buildProvider(ctx, providerAccount, routed);
    await provider.listen({ host: "127.0.0.1", port: providerPort }); cleanup.push(async () => { await provider.close(); });
    const gateway = buildGateway({ context: ctx });
    await gateway.listen({ host: "127.0.0.1", port: gatewayPort }); cleanup.push(async () => { await gateway.close(); });
    const providerClient = new EmeterClient({ gatewayUrl: cfg.gatewayOrigin, rpcUrl: rpc, vault: cfg.vault, registry: cfg.registry });
    await providerClient.authenticate(providerAccount);
    const manifests = builtInServices(ctx);
    for (const manifest of options.registerServices === false ? [] : Object.values(manifests)) {
      stage = "endpoint probe: " + manifest.method;
      const prepared = await providerClient.registerService(manifest) as { status: string; transaction?: { to: Address; data: Hex } };
      if (prepared.status !== "awaiting_chain_registration" || !prepared.transaction) throw new Error("Provider registration preparation failed");
      stage = "local registration transaction: " + manifest.method;
      await send(providerAccount, prepared.transaction.to, prepared.transaction.data);
      stage = "registered endpoint verification: " + manifest.method;
      const registered = await providerClient.registerService(manifest) as { status: string };
      if (registered.status !== "registered") throw new Error("Provider endpoint registration failed");
    }
    let workers: Awaited<ReturnType<typeof startWorkers>> | undefined;
    const start = async () => { if (!workers) workers = await startWorkers(ctx, relayer); };
    const stop = async () => { if (workers) { await workers.close(); workers = undefined; } };
    cleanup.push(stop);
    const sessions: { id: Hex; customer: PrivateKeyAccount; budget: bigint }[] = [];
    const makeSession = async (options: { budget?: bigint; softLimit?: bigint; serviceIds?: Hex[] } = {}) => {
      let sessionStage = "mint sponsored credit";
      try {
      const customer = privateKeyToAccount(generatePrivateKey()), delegate = privateKeyToAccount(generatePrivateKey());
      const budget = options.budget ?? 1_000_000n;
      const ids = options.serviceIds ?? Object.values(manifests).map(v => v.serviceId).sort();
      await fundPaymentToken(original.customer, budget);
      sessionStage = "approve sponsored credit";
      await send(original.customer, cfg.token, encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]), functionName: "approve", args: [cfg.vault, budget] }));
      sessionStage = "deposit customer credit";
      await send(original.customer, cfg.vault, encodeFunctionData({ abi: emeterVaultAbi, functionName: "depositFor", args: [customer.address, budget] }));
      const head = await client.getBlock();
      const grant = { customer: customer.address, signer: delegate.address, budget, softLimit: options.softLimit ?? budget,
        maxCharge: budget < 50_000n ? budget : 50_000n, expiresAt: head.timestamp + 900n,
        settlementWindow: 120n, serviceSetHash: serviceSetHash(ids), nonce: 0n };
      const prepared = await ctx.sessions.prepareSession(grant, ids);
      sessionStage = "relay the customer-signed session";
      const signed = await ctx.sessions.signSession(prepared, customer);
      await send(relayer, cfg.vault, signed.transaction.data);
      sessions.push({ id: signed.sessionId, customer, budget });
      const sdk = new EmeterClient({ gatewayUrl: cfg.gatewayOrigin, rpcUrl: rpc, vault: cfg.vault, registry: cfg.registry,
        sessionId: signed.sessionId, sessionSigner: delegate, customerSigner: customer });
      sessionStage = "wallet login"; await sdk.authenticate(customer);
      sessionStage = "create session-scoped execution key";
      const key = await sdk.createApiKey({ sessionId: signed.sessionId, scopes: ["execute", "request:read"] });
      const agent = new EmeterClient({ gatewayUrl: cfg.gatewayOrigin, rpcUrl: rpc, vault: cfg.vault, registry: cfg.registry,
        sessionId: signed.sessionId, sessionSigner: delegate, customerSigner: customer, token: key.key });
      return { customer, delegate, sdk, agent, key, id: signed.sessionId };
      } catch (error) { throw new Error("Customer fixture failed at " + sessionStage, { cause: error }); }
    };
    const useLiveAi = async () => {
      process.env.EMETER_AI_PROVIDER = "otari";
      process.env.EMETER_OTARI_ENV_FILE ??= join(homedir(), ".local/share/emeter/credentials/otari.env");
      const live = await createAnalyzer(cfg.container, providerAccount.signMessage);
      if (!live.price || live.price.currency !== "USD"
        || Number(usageAmount({ prompt_tokens: 8192, completion_tokens: 1024, total_tokens: 9216 }, live.price)) > 0.01)
        throw new Error("Live AI proof requires verified pricing below the $0.01 test ceiling");
      routed.model = live.model; routed.runtime = "otari-api";
      activeAnalyzer = { ...live, analyze: async text => { counters.liveAi++; return live.analyze(text); } };
      return { model: live.model, price: live.price };
    };
    const restartProvider = async () => {
      await provider.close(); provider = buildProvider(ctx, providerAccount, routed);
      await provider.listen({ host: "127.0.0.1", port: providerPort });
    };
    return { ctx, client, test, send, relayer, providerAccount, providerClient, manifests, gateway, get provider() { return provider; },
      makeSession, fundPaymentToken, sessions, counters, useLiveAi, start, stop, close, forkBlock,
      restartProvider, forkBlockHash: sourceBlock.hash,
      deposited: () => sessions.reduce((sum, row) => sum + row.budget, 0n) };
  } catch (error) { await close(); throw new Error("Gateway harness failed at " + stage, { cause: error }); }
}
export type GatewayHarness = Awaited<ReturnType<typeof createGatewayHarness>>;
