import { chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
import { encodeFunctionData, decodeFunctionData, formatUnits, hexToString, parseAbi } from "viem";
import type { Address, Hex, TypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EmeterClient } from "@emeter/sdk";
import { emeterRegistryAbi, emeterVaultAbi } from "@emeter/shared";
import { createGatewayHarness } from "../../gateway/test/harness";
import { short } from "../lib/models";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifactLabel = process.env.EMETER_BROWSER_ARTIFACT_LABEL;
const okxWallet = process.env.EMETER_TEST_WALLET_PROVIDER === "okx";
const usdc = process.env.EMETER_BROWSER_USE_USDC === "true", currency = usdc ? "USDC" : "DEMO";
if (artifactLabel && !/^[a-z0-9-]{1,24}$/.test(artifactLabel)) throw new Error("Invalid browser artifact label");
const reviewDirectory = join(root, ".impeccable/review", artifactLabel ?? "");
const evidencePath = join(root, "docs/evidence", artifactLabel ? "frontend-" + artifactLabel + "-fork-checks.json" : "frontend-fork-checks.json");
const ensure = expect.configure({ timeout: 45_000 });
const checks: { name: string; passed: true }[] = [];
const check = (name: string) => { checks.push({ name, passed: true }); process.stdout.write("PASS " + name + "\n"); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function main() {
  process.stdout.write("Preparing disposable gateway, PostgreSQL database, Redis queues, and Anvil fork.\n");
  const port = await freePort(), origin = "http://127.0.0.1:" + port;
  const harness = await createGatewayHarness({ browserOrigins: [origin], registerServices: false, usdc });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let web: ReturnType<typeof spawn> | undefined;
  let debugPage: Page | undefined;
  const serverLog = createWriteStream("/tmp/emeter-web-browser-server.log", { flags: "w", mode: 0o600 });
  const captures: string[] = [];
  const walletTransactions: { hash: Hex; to: Address; action: string; amount?: string }[] = [];
  let messageSignatures = 0, typedSignatures = 0, wrongWalletHash = false, corruptConfirmation = false;
  let rejectSignIn = false;
  const customer = privateKeyToAccount(generatePrivateKey());
  let selectedWallet = harness.providerAccount;
  const cfg = harness.ctx.config;
  await writeFile("/tmp/emeter-frontend-active-resources.json", JSON.stringify({ databaseName: new URL(cfg.databaseUrl).pathname.slice(1),
    queuePrefix: cfg.queuePrefix, rpcUrl: cfg.rpcUrl, gatewayOrigin: cfg.gatewayOrigin, providerOrigin: cfg.providerOrigin, webOrigin: origin }) + "\n");
  try {
    await harness.start();
    await harness.test.setBalance({ address: customer.address, value: 10_000_000_000_000_000_000n });
    await harness.fundPaymentToken(customer.address, 5_000_000n);
    const nextBinary = join(root, "apps/web/node_modules/next/dist/bin/next");
    await access(join(root, "apps/web/.next/BUILD_ID"));
    web = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", process.execPath, nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: join(root, "apps/web"), env: { ...process.env, EMETER_PAYMENT_ASSET: currency, EMETER_VAULT_ADDRESS: cfg.vault, EMETER_NETWORK_MODE: "local-fork", EMETER_PUBLIC_GATEWAY_URL: cfg.gatewayOrigin, EMETER_PUBLIC_RPC_URL: cfg.rpcUrl, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", serverLog, serverLog], detached: true
    });
    let started = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(origin + "/api/config", { signal: AbortSignal.timeout(1000) })).ok) { started = true; break; } } catch { /* Wait for Next startup. */ }
      if (web.exitCode !== null) throw new Error("Web server stopped; see /tmp/emeter-web-browser-server.log.");
      await pause(500);
    }
    assert(started, "Next.js started");
    const publicConfig = await (await fetch(origin + "/api/config")).json();
    assert(publicConfig.gatewayUrl === cfg.gatewayOrigin && publicConfig.rpcUrl === cfg.rpcUrl, "Production runtime config matches the disposable gateway and fork");
    const executablePath = process.env.EMETER_BROWSER_BINARY ?? "/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome";
    await access(executablePath);
    browser = await chromium.launch({ executablePath, headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.grantPermissions(["local-network-access"], { origin });
    await context.exposeBinding("__emeterWalletRequest", async (_source, raw: { method: string; params?: unknown[] }) => {
      const params = raw.params ?? [];
      if (raw.method === "eth_accounts" || raw.method === "eth_requestAccounts") return [selectedWallet.address];
      if (raw.method === "eth_chainId") return "0xc4";
      if (raw.method === "eth_getBlockByNumber") {
        const block = await harness.client.request({ method: "eth_getBlockByNumber", params: params as [Hex, false] });
        return wrongWalletHash && block ? { ...block, hash: "0x" + "f".repeat(64) } : block;
      }
      if (raw.method === "personal_sign") {
        if (rejectSignIn) { rejectSignIn = false; throw Object.assign(new Error("User rejected the request"), { code: 4001 }); }
        assert(String(params[1]).toLowerCase() === selectedWallet.address.toLowerCase(), "Signing wallet matches");
        const message = hexToString(params[0] as Hex);
        assert(message.startsWith("emeter gateway authentication\nOrigin: " + cfg.gatewayOrigin + "\nChain ID: 196\n"), "Only gateway login messages are signed");
        messageSignatures++; return selectedWallet.signMessage({ message: { raw: params[0] as Hex } });
      }
      if (raw.method === "eth_signTypedData_v4") {
        assert(String(params[0]).toLowerCase() === selectedWallet.address.toLowerCase(), "Typed signing wallet matches");
        const data = JSON.parse(String(params[1]));
        assert(Number(data.domain.chainId) === 196 && data.domain.verifyingContract.toLowerCase() === cfg.vault.toLowerCase(), "Typed data stays on fork vault");
        typedSignatures++;
        return selectedWallet.signTypedData(data as { domain: { chainId: number; verifyingContract: Address }; types: TypedData; primaryType: string; message: Record<string, unknown> });
      }
      if (raw.method === "eth_sendTransaction") {
        const transaction = params[0] as { from: Address; to: Address; data: Hex; value?: Hex };
        assert(cfg.networkMode === "local-fork" && new URL(cfg.rpcUrl).hostname === "127.0.0.1", "Transactions are restricted to the isolated fork");
        assert(transaction.from.toLowerCase() === selectedWallet.address.toLowerCase() && BigInt(transaction.value ?? "0") === 0n, "Only selected wallet and zero native value");
        assert([cfg.vault, cfg.token, cfg.registry].some(to => to.toLowerCase() === transaction.to.toLowerCase()), "Transaction targets deployed emeter contracts");
        const abi = transaction.to.toLowerCase() === cfg.token.toLowerCase() ? parseAbi(["function approve(address,uint256) returns(bool)"])
          : transaction.to.toLowerCase() === cfg.registry.toLowerCase() ? emeterRegistryAbi : emeterVaultAbi;
        const decoded = decodeFunctionData({ abi, data: transaction.data });
        assert(["approve", "deposit", "createSession", "closeSession", "revokeSessionSigner", "refund", "withdrawAvailable", "registerService"].includes(decoded.functionName), "Wallet action is within the browser test");
        if (decoded.functionName === "approve") {
          assert(String(decoded.args![0]).toLowerCase() === cfg.vault.toLowerCase() && BigInt(String(decoded.args![1])) === 1_000_000n, "Token approval is exactly one unit of the payment currency");
        }
        process.stdout.write("Wallet action: " + decoded.functionName + "\n");
        const receipt = await harness.send(selectedWallet, transaction.to, transaction.data);
        process.stdout.write("Wallet confirmed: " + decoded.functionName + "\n");
        walletTransactions.push({ hash: receipt.transactionHash, to: transaction.to, action: decoded.functionName,
          ...(decoded.functionName === "approve" ? { amount: String(decoded.args![1]) } : {}) });
        return receipt.transactionHash;
      }
      throw new Error("Unsupported test wallet method: " + raw.method);
    });
    await context.addInitScript({ content: `(() => {
      const listeners = new Map();
      const provider = {
        request(args) { return window.__emeterWalletRequest(args); },
        on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
        removeListener(event, listener) { listeners.get(event)?.delete(listener); }
      };
      if (${okxWallet}) {
        provider.isOkxWallet = true;
        window.okxwallet = provider;
        window.ethereum = { isMetaMask: true, request() { return Promise.reject(Object.assign(new Error("User rejected the request"), { code: 4001 })); } };
        window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
          detail: { info: { name: "OKX Wallet", rdns: "com.okex.wallet", uuid: "okx-test" }, provider }
        })));
      } else window.ethereum = provider;
      window.__emeterWalletChanged = function(event, payload) { for (const listener of listeners.get(event) || []) listener(payload); };
    })();` });
    const page = await context.newPage(); debugPage = page; page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(60_000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", failure => { runtimeErrors.push(failure.message); process.stderr.write("Browser runtime: " + failure.message.slice(0, 600) + "\n"); });
    page.on("requestfailed", request => { if (request.url().startsWith(cfg.gatewayOrigin) || request.url().startsWith(cfg.rpcUrl))
      process.stderr.write("Browser request failed: " + new URL(request.url()).pathname + " " + request.failure()?.errorText + "\n"); });
    await mkdir(reviewDirectory, { recursive: true });
    const capture = async (target: Page, name: string) => {
      await target.evaluate(() => window.scrollTo(0, 0)); await target.evaluate(() => document.fonts.ready); await pause(400);
      if (await target.locator(".workspace").count()) {
        assert.equal(await target.locator(".workspace-sidebar").count(), 1, "Workspace uses the selected sidebar");
        await ensure(target.locator('.workspace-nav a')).toHaveCount(5);
        await ensure(target.locator(".workspace-nav")).toBeVisible();
        await ensure(target.locator('.workspace-nav [aria-current="page"]')).toBeInViewport({ ratio: 1 });
      }
      const path = join(reviewDirectory, name + ".png"); await target.screenshot({ path, fullPage: true, animations: "disabled" }); captures.push(path);
      const overflow = await target.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert(!overflow, "No page overflow: " + name);
    };
    const navigate = async (name: string) => { await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name, exact: true }).click(); };
    const connect = async () => {
      await page.getByRole("button", { name: /^(Connect wallet|Sign in)$/ }).first().click();
      if (okxWallet) await page.getByRole("dialog").getByRole("button", { name: "OKX Wallet", exact: true }).click();
      await ensure(page.locator(".wallet-menu")).toBeVisible();
    };
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await ensure(page.getByRole("heading", { level: 1 })).toContainText("spending limit");
    await page.getByRole("button", { name: "Soft limit reached", exact: true }).click(); await ensure(page.getByText("Payment denied", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Customer override", exact: true }).click(); await ensure(page.getByText("Payment allowed", { exact: true })).toBeVisible();
    assert(typedSignatures === 0 && walletTransactions.length === 0, "Preview grants no permission"); check("Interactive preview grants no wallet permission");
    await page.getByRole("button", { name: "Within limits", exact: true }).click(); await capture(page, "desktop");
    await page.getByRole("link", { name: "Open workspace", exact: true }).click(); await capture(page, "dashboard-empty-desktop");
    await navigate("Services"); await page.getByRole("button", { name: "Provider & credentials", exact: true }).click();
    if (okxWallet) {
      await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
      const chooser = page.getByRole("dialog");
      await ensure(chooser.getByRole("button", { name: "OKX Wallet", exact: true })).toHaveCount(1);
      await chooser.getByRole("button", { name: "MetaMask", exact: true }).click();
      await ensure(chooser.getByText(/wallet connection was declined/)).toBeVisible();
      assert(messageSignatures === 0 && walletTransactions.length === 0, "Decoy refusal grants no signature or spending permission");
      await capture(page, "wallet-connection-declined-desktop");
      rejectSignIn = true;
      await chooser.getByRole("button", { name: "OKX Wallet", exact: true }).click();
      await ensure(chooser.getByText(/sign-in signature was declined/)).toBeVisible();
      assert(messageSignatures === 0 && walletTransactions.length === 0, "Declined login grants no signature or spending permission");
      await capture(page, "wallet-sign-in-declined-desktop");
      await chooser.getByRole("button", { name: "OKX Wallet", exact: true }).click();
      await ensure(page.locator(".wallet-menu")).toBeVisible();
      await ensure(chooser).not.toBeVisible();
      check("Explicit OKX selection with decoy MetaMask, deduplicated announcements, connection/sign-in refusal and retry");
    } else await connect();
    for (const manifest of Object.values(harness.manifests)) {
      await page.getByLabel("Service manifest JSON").fill(JSON.stringify(manifest, null, 2));
      await page.getByRole("button", { name: "Verify endpoint and register", exact: true }).click();
      await ensure(page.getByText("Endpoint signature and onchain service terms verified.", { exact: true })).toBeVisible();
    }
    assert(walletTransactions.filter(tx => tx.action === "registerService").length === 2, "Two provider registrations were wallet-sent"); check("Provider endpoint probes and browser registration transactions");
    await page.getByRole("button", { name: "Create credential", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Create credential", exact: true }).click();
    await ensure(page.getByText("Copy this credential now", { exact: true })).toBeVisible();
    const providerKey = (await page.locator(".key-once code").textContent())!;
    const scopedProvider = new EmeterClient({ gatewayUrl: cfg.gatewayOrigin, token: providerKey, rpcUrl: cfg.rpcUrl });
    const scopedUsage = await scopedProvider.getUsage() as { services: unknown[] };
    assert(scopedUsage.services.length === 1, "Provider credential is scoped to one service");
    await assert.rejects(() => scopedProvider.getAccount(), failure => failure instanceof Error && "status" in failure && failure.status === 401);
    await page.getByRole("button", { name: "I’ve saved it; hide credential", exact: true }).click();
    await page.locator("table").first().locator("tbody tr").first().getByRole("button", { name: "Revoke", exact: true }).click();
    await ensure(page.locator("table").first().getByText("Revoked", { exact: true })).toBeVisible(); check("Provider credential scope, account refusal, and revocation");
    await capture(page, "provider-desktop");
    selectedWallet = customer;
    await page.evaluate(address => (window as unknown as { __emeterWalletChanged: (event: string, payload: unknown) => void }).__emeterWalletChanged("accountsChanged", [address]), customer.address);
    await ensure(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible();
    await navigate("Overview"); await connect();
    await page.getByRole("button", { name: "Deposit credit", exact: true }).click();
    await page.getByRole("dialog").getByLabel(`Amount (${currency})`).fill("1");
    await page.getByRole("dialog").getByRole("button", { name: "Approve and deposit", exact: true }).click();
    await ensure(page.getByRole("dialog")).not.toBeVisible();
    assert(await harness.client.readContract({ address: cfg.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [customer.address] }) === 1_000_000n, "Deposited credit is real chain state");
    check("Wallet login and exact approval/deposit into live credit");
    const jsonService = harness.manifests["json-validator"]!;
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByRole("dialog").getByLabel(`Soft limit (${currency})`).fill(formatUnits(BigInt(jsonService.priceBaseUnits), 6));
    await page.getByRole("dialog").getByRole("button", { name: "Sign limits and create session", exact: true }).click();
    await ensure(page.getByRole("dialog")).not.toBeVisible(); await ensure(page.locator(".session-row")).toHaveCount(1);
    const indexed = await harness.ctx.db.spendingSession.findFirstOrThrow({ where: { customer: customer.address.toLowerCase() } });
    const sessionId = indexed.id as Hex;
    if (okxWallet) {
      const signaturesBeforeNotification = messageSignatures;
      await page.evaluate(address => (window as unknown as { __emeterWalletChanged: (event: string, payload: unknown) => void }).__emeterWalletChanged("accountsChanged", [address]), customer.address);
      await pause(300);
      await ensure(page.locator(".wallet-menu")).toBeVisible();
      await ensure(page.getByText("2 allowed services · Key in this tab", { exact: true })).toBeVisible();
      assert(messageSignatures === signaturesBeforeNotification, "Duplicate account event does not require another login");
      check("Repeated selected-account notification retains authenticated identity and tab session key");
    }
    const chainSession = () => harness.client.readContract({ address: cfg.vault, abi: emeterVaultAbi, functionName: "getSession", args: [sessionId] });
    assert((await chainSession()).budget === 500_000n, "Bounded session budget is onchain");
    await ensure(page.getByText("2 allowed services · Key in this tab", { exact: true })).toBeVisible(); check("Customer-signed bounded session with tab-only delegated key");
    await capture(page, "dashboard-session-desktop");
    await navigate("Services"); await page.getByRole("button", { name: "Service catalog", exact: true }).click();
    await page.locator(".service-row").filter({ hasText: "JSON Validator" }).getByRole("link", { name: "Try service", exact: true }).click();
    await ensure(page.getByLabel("JSON document")).toBeVisible();
    await page.getByRole("button", { name: "Run request", exact: true }).click();
    await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible();
    const first = await harness.ctx.db.aPIRequest.findFirstOrThrow({ where: { customer: customer.address.toLowerCase() }, orderBy: { createdAt: "desc" } });
    assert(first.paymentStatus === "settled" && (first.result as { valid: boolean }).valid, "JSON output and payment settled");
    check("JSON document/schema execution, signed output, and canonical payment");
    await capture(page, "playground-desktop");
    await page.getByRole("link", { name: "Inspect receipt", exact: true }).click();
    await ensure(page.getByRole("heading", { name: "Receipt inspector", exact: true })).toBeVisible();
    await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible();
    await ensure(page.getByText("Canonical settlement inputs", { exact: true })).toBeVisible();
    await capture(page, "receipt-desktop"); check("Independent browser receipt, price version, signature, and settlement inspection");
    await navigate("Policy explorer"); await page.getByRole("button", { name: "From a receipt", exact: true }).click();
    await page.getByLabel("Your request").selectOption(first.id);
    await page.getByRole("button", { name: "Verify and load inputs", exact: true }).click();
    await ensure(page.getByText("Canonical settlement inputs", { exact: true })).toBeVisible();
    await capture(page, "policy-receipt-desktop"); check("Circuit visualization driven by verified receipt inputs");
    await navigate("Playground"); await page.getByRole("button", { name: "Start a new request", exact: true }).click();
    await ensure(page.getByLabel("Service", { exact: true })).toHaveValue(jsonService.serviceId);
    await page.getByRole("button", { name: "Review approval and run", exact: true }).click();
    const beforeOverride = typedSignatures;
    await ensure(page.getByRole("dialog").getByRole("button", { name: "Sign approval and run", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("dialog").getByRole("button", { name: "Sign approval and run", exact: true }).click();
    await ensure(page.getByRole("dialog")).not.toBeVisible(); await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible();
    assert(typedSignatures === beforeOverride + 1 && (await chainSession()).spent === 40_000n, "Only precise customer override crosses soft limit");
    check("Explicit cumulative customer override and second canonical payment");
    await page.getByRole("button", { name: "Start a new request", exact: true }).click();
    await page.getByLabel("Service", { exact: true }).selectOption(harness.manifests["text-analyzer"]!.serviceId);
    await page.getByRole("button", { name: "Review approval and run", exact: true }).click(); await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("dialog").getByRole("button", { name: "Sign approval and run", exact: true }).click();
    await ensure(page.getByRole("dialog")).not.toBeVisible(); await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible();
    await ensure(page.getByText("Controlled offline fixture", { exact: false })).toBeVisible();
    assert(harness.counters.fixtureAi === 1 && harness.counters.liveAi === 0, "AI browser proof uses a labeled offline fixture"); check("AI fixture runtime, usage evidence, and canonical settlement");
    await page.getByRole("button", { name: "Start a new request", exact: true }).click();
    await page.getByLabel("Service", { exact: true }).selectOption(jsonService.serviceId);
    let accepted = false;
    page.on("request", request => { if (request.method() === "POST" && request.url().startsWith(cfg.gatewayOrigin + "/api/execute/")) accepted = true; });
    await page.route(cfg.gatewayOrigin + "/api/requests/*", async route => {
      if (accepted) await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"GATEWAY_OPERATION_FAILED"}' }); else await route.continue();
    });
    await page.getByRole("button", { name: "Review approval and run", exact: true }).click(); await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("dialog").getByRole("button", { name: "Sign approval and run", exact: true }).click();
    await ensure(page.getByText("Recover the same request", { exact: true })).toBeVisible();
    if (await page.getByRole("dialog").isVisible()) await page.getByRole("dialog").getByRole("button", { name: "Close dialog", exact: true }).click();
    const retained = await harness.ctx.db.aPIRequest.findFirstOrThrow({ where: { customer: customer.address.toLowerCase() }, orderBy: { createdAt: "desc" } });
    const executionKey = await harness.ctx.db.aPIKey.findFirstOrThrow({ where: { wallet: customer.address.toLowerCase(), scopes: { has: "execute" }, revokedAt: null } });
    await harness.ctx.db.aPIKey.update({ where: { id: executionKey.id }, data: { revokedAt: new Date() } });
    await page.unroute(cfg.gatewayOrigin + "/api/requests/*");
    await page.getByRole("button", { name: "Recover the same request", exact: true }).click();
    await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible();
    const recovered = await harness.ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: retained.id } });
    assert(recovered.chargeSignature === retained.chargeSignature && await harness.ctx.db.aPIRequest.count({ where: { customer: customer.address.toLowerCase() } }) === 4, "Recovery reuses request identity and authorization");
    check("Status outage recovery refreshes a revoked key and retains one request, nonce, and signed authorization");
    await navigate("Services"); await page.getByRole("button", { name: "Provider & credentials", exact: true }).click();
    await page.getByRole("button", { name: "Create credential", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("checkbox").uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Create credential", exact: true }).click();
    await ensure(page.getByText("Copy this credential now", { exact: true })).toBeVisible();
    const sessionReadKey = (await page.locator(".key-once code").textContent())!;
    await assert.rejects(() => new EmeterClient({ gatewayUrl: cfg.gatewayOrigin, token: sessionReadKey, rpcUrl: cfg.rpcUrl }).getAccount(),
      failure => failure instanceof Error && "status" in failure && failure.status === 403);
    await page.getByRole("button", { name: "I’ve saved it; hide credential", exact: true }).click();
    const keyRecord = await harness.ctx.db.aPIKey.findFirstOrThrow({ where: { wallet: customer.address.toLowerCase() }, orderBy: { createdAt: "desc" } });
    await page.locator("table").first().locator("tbody tr").first().getByRole("button", { name: "Revoke", exact: true }).click();
    await ensure.poll(async () => Boolean((await harness.ctx.db.aPIKey.findUniqueOrThrow({ where: { id: keyRecord.id } })).revokedAt)).toBe(true);
    check("Session read credential is shown once and revoked from the UI");
    await navigate("Overview"); await capture(page, "dashboard-desktop");
    await navigate("Services"); await capture(page, "services-desktop");
    await navigate("Receipts"); await capture(page, "receipts-desktop");
    await navigate("Policy explorer"); await page.getByRole("button", { name: "Interactive preview", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" }); await capture(page, "policy-reduced-motion-desktop");
    assert(await page.locator(".circuit-webgl").count() === 0, "Reduced motion uses flat circuit");
    await page.setViewportSize({ width: 390, height: 844 }); await capture(page, "policy-mobile");
    await navigate("Overview"); await capture(page, "dashboard-mobile");
    await navigate("Services"); await page.getByRole("button", { name: "Service catalog", exact: true }).click(); await capture(page, "services-mobile");
    await navigate("Playground"); await capture(page, "playground-mobile");
    await page.getByRole("link", { name: "Inspect receipt", exact: true }).click();
    await ensure(page.getByRole("heading", { name: "Receipt inspector", exact: true })).toBeVisible();
    await ensure(page.getByText("Canonical payment verified", { exact: true })).toBeVisible(); await capture(page, "receipt-mobile");
    await navigate("Receipts"); await capture(page, "receipts-mobile");
    check("Desktop/mobile layout, page overflow, and reduced-motion fallback");
    const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await anonymous.grantPermissions(["local-network-access"], { origin });
    const phone = await anonymous.newPage(); await phone.goto(origin, { waitUntil: "domcontentloaded" });
    await ensure(phone.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeEnabled();
    await capture(phone, "mobile"); await anonymous.close();
    await page.setViewportSize({ width: 1440, height: 960 }); await navigate("Overview");
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await ensure(page.getByRole("dialog").getByLabel(`Hard budget (${currency})`)).toBeFocused();
    await page.keyboard.press("Escape"); await ensure(page.getByRole("dialog")).not.toBeVisible();
    await ensure(page.getByRole("button", { name: "New session", exact: true })).toBeFocused(); check("Native dialog keyboard focus, escape, and focus restoration");
    const originalRefundAfter = (await chainSession()).refundAfter;
    await page.evaluate(() => (window as unknown as { __emeterWalletChanged: (event: string, payload: unknown) => void }).__emeterWalletChanged("chainChanged", "0xc4"));
    await ensure(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeVisible(); await connect();
    await ensure(page.getByText("2 allowed services · Key unavailable in this tab", { exact: true })).toBeVisible();
    const transactionsBeforeMismatch = walletTransactions.length, signaturesBeforeMismatch = typedSignatures;
    wrongWalletHash = true;
    await page.getByRole("button", { name: "Deposit credit", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve and deposit", exact: true }).click();
    await ensure(page.getByRole("dialog").getByText(/different versions of X Layer/)).toBeVisible();
    assert(walletTransactions.length === transactionsBeforeMismatch && typedSignatures === signaturesBeforeMismatch, "Network mismatch prevents a signature and broadcast");
    await capture(page, "network-mismatch-desktop"); wrongWalletHash = false;
    await page.getByRole("dialog").getByRole("button", { name: "Close dialog", exact: true }).click();
    check("Same-chain-ID fork mismatch refuses wallet writes");
    await page.locator(".session-row").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close this session", exact: true }).click(); await ensure(page.getByRole("dialog")).not.toBeVisible();
    assert((await chainSession()).refundAfter === originalRefundAfter, "Closing preserves original refund window");
    await page.locator(".session-row").getByRole("button", { name: "Revoke signer", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke this signer", exact: true }).click(); await ensure(page.getByRole("dialog")).not.toBeVisible();
    assert((await chainSession()).signerRevoked, "Wallet revocation works after tab key loss");
    const head = await harness.client.getBlock(); await harness.test.increaseTime({ seconds: Number(originalRefundAfter - head.timestamp + 2n) }); await harness.test.mine({ blocks: 4 });
    await page.getByRole("button", { name: "Refresh account", exact: true }).click();
    await ensure(page.locator(".session-row").getByRole("button", { name: "Refund", exact: true })).toBeEnabled();
    await page.locator(".session-row").getByRole("button", { name: "Refund", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Refund unused credit", exact: true }).click(); await ensure(page.getByRole("dialog")).not.toBeVisible();
    assert((await chainSession()).status === 3, "Refund reaches chain state"); check("Lost-key close, signer revocation, original refund timing, and refund");
    const available = await harness.client.readContract({ address: cfg.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [customer.address] });
    await page.route(cfg.rpcUrl, async route => {
      const body = route.request().postDataJSON();
      const response = await route.fetch();
      if (corruptConfirmation && body.method === "eth_getTransactionByHash") {
        const answer = await response.json(); if (answer.result) answer.result.from = cfg.token;
        await route.fulfill({ response, json: answer });
      } else await route.fulfill({ response });
    });
    corruptConfirmation = true;
    await page.getByRole("button", { name: "Withdraw available credit", exact: true }).click(); await page.getByRole("dialog").getByLabel(`Amount (${currency})`).fill(formatUnits(available, 6));
    const writesBeforeWithdrawal = walletTransactions.length;
    await page.getByRole("dialog").getByRole("button", { name: "Withdraw to wallet", exact: true }).click();
    await ensure(page.getByRole("dialog").getByText(/does not match the retained wallet action/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close dialog", exact: true }).click();
    await ensure(page.getByRole("button", { name: "Check transaction", exact: true })).toBeVisible();
    corruptConfirmation = false; await page.getByRole("button", { name: "Check transaction", exact: true }).click();
    await ensure(page.getByRole("button", { name: "Check transaction", exact: true })).not.toBeVisible();
    assert(walletTransactions.length === writesBeforeWithdrawal + 1, "Confirmation recovery sends no replacement transaction");
    assert(await harness.client.readContract({ address: cfg.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [customer.address] }) === 0n, "Credit withdrew to owning wallet");
    await page.unroute(cfg.rpcUrl); check("Pending hash retention, canonical recheck, and no replacement withdrawal");
    const storage = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    assert(!storage.some(key => /token|credential|signer|private|session.key/i.test(key)), "No signing material or credentials persisted in browser storage");
    assert(runtimeErrors.length === 0, "No browser runtime errors: " + runtimeErrors.join("; "));
    check("No browser runtime errors or persisted signing credentials");
    const records = await harness.ctx.db.aPIRequest.findMany({ where: { customer: customer.address.toLowerCase() }, orderBy: { createdAt: "asc" } });
    await writeFile(evidencePath, JSON.stringify({ milestone: "frontend", chainId: 196, paymentToken: cfg.token, paymentCurrency: currency, vault: cfg.vault,
      networkMode: "local-fork", participantClassification: "temporary builder-controlled browser wallets",
      walletProvider: okxWallet ? "simulated dedicated OKX provider with rejecting MetaMask decoy and EIP-6963 announcement" : "simulated legacy injected provider",
      workloadClassification: "actual JSON/schema validation and signed offline AI fixture; no new paid AI call",
      mainnetBroadcastPerformed: false, forkBlock: harness.forkBlock.toString(), forkBlockHash: harness.forkBlockHash, checks,
      requests: records.map(row => ({ requestId: row.id, serviceId: row.serviceId, requestStatus: row.requestStatus,
        paymentStatus: row.paymentStatus, priceBaseUnits: row.amount.toFixed(0), policyInputs: row.policyInputs })),
      walletTransactions, messageSignatures, typedSignatures, screenshots: captures.map(path => path.slice(root.length)),
      completedAt: new Date().toISOString() }, null, 2) + "\n");
    process.stdout.write("Frontend browser proof passed: " + checks.length + " checks, " + captures.length + " captures.\n");
    await context.close();
  } catch (failure) {
    if (debugPage) {
      try {
        const feedback = await debugPage.locator(".feedback-error, .inline-error, .feedback-progress").allTextContents();
        process.stderr.write("Page feedback: " + JSON.stringify(feedback) + "\n");
        await debugPage.locator(".key-once").evaluateAll(nodes => nodes.forEach(node => (node as HTMLElement).style.visibility = "hidden"));
        await debugPage.screenshot({ path: join(reviewDirectory, "browser-failure.png"), fullPage: true, animations: "disabled" });
      } catch { /* Never lose test cleanup to diagnostics. */ }
    }
    throw failure;
  } finally {
    if (browser) await browser.close();
    if (web?.pid) { try { process.kill(-web.pid, "SIGTERM"); } catch { web.kill("SIGTERM"); } }
    serverLog.end(); await harness.close();
  }
}
main().then(async () => {
  if (process.env.EMETER_BROWSER_RESULT_PATH) await writeFile(process.env.EMETER_BROWSER_RESULT_PATH, JSON.stringify({ passed: true, checks: checks.length }) + "\n");
}).catch(async failure => {
  const message = failure instanceof Error ? failure.message : String(failure);
  process.stderr.write(message + "\n");
  if (process.env.EMETER_BROWSER_RESULT_PATH) await writeFile(process.env.EMETER_BROWSER_RESULT_PATH, JSON.stringify({ passed: false, error: message }) + "\n");
  process.exitCode = 1;
});
