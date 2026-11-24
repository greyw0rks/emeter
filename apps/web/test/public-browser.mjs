import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createPublicClient, http, parseAbi } from "viem";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = process.env.EMETER_PUBLIC_APP_URL ?? "https://emeter-peach.vercel.app";
assert.equal(new URL(origin).protocol, "https:");
const gatewayUrl = "https://first-eel-292.convex.site", rpcUrl = "https://rpc.xlayer.tech";
const checks = [], screenshots = [];
const ensure = expect.configure({ timeout: 45_000 });
const check = name => { checks.push({ name, passed: true }); process.stdout.write("PASS " + name + "\n"); };
const artifactLabel = process.env.EMETER_PUBLIC_BROWSER_ARTIFACT_LABEL;
const okxWallet = process.env.EMETER_TEST_WALLET_PROVIDER === "okx";
assert(!artifactLabel || /^[a-z0-9-]+$/.test(artifactLabel));
const directory = join(root, ".impeccable/review", artifactLabel ? artifactLabel + "-public" : "public");
let browser;
try {
  const config = await (await fetch(origin + "/api/config", { signal: AbortSignal.timeout(30_000) })).json();
  assert.equal(config.gatewayUrl, gatewayUrl);
  assert.equal(config.rpcUrl, rpcUrl);
  const engine = JSON.parse(await readFile(join(root, "deployments/xlayer-196-usdc.json"), "utf8"));
  assert(engine.completed);
  assert.equal(config.deployment.vault.toLowerCase(), engine.contracts.vault.toLowerCase());
  assert.equal(config.deployment.registry.toLowerCase(), engine.contracts.registry.toLowerCase());
  assert.equal(config.deployment.token.toLowerCase(), engine.token.toLowerCase());
  check("Public production configuration selects the hosted gateway and X Layer RPC");
  browser = await chromium.launch({
    executablePath: process.env.EMETER_BROWSER_BINARY ?? "/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
    headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  });
  await mkdir(directory, { recursive: true });
  const errors = [];
  const forbidden = [];
  for (const [name, viewport] of [["desktop", { width: 1440, height: 960 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: name === "mobile" ? "reduce" : "no-preference" });
    if (okxWallet) await context.addInitScript(({ dedicated }) => {
      const provider = { isOkxWallet: true, request() { throw new Error("Public discovery smoke must not request wallet permissions"); } };
      if (dedicated) window.okxwallet = provider;
      window.ethereum = { isMetaMask: true, request() { throw new Error("Public discovery smoke must not request wallet permissions"); } };
      window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: { info: { name: "OKX Wallet", rdns: "com.okex.wallet", uuid: "okx-public-test" }, provider }
      })));
    }, { dedicated: name === "desktop" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/(execute|settlements)|\/services\/.*\/(text_analyze|json_validate)/.test(request.url())) forbidden.push(request.url());
    });
    const capture = async label => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      if (await page.locator(".workspace").count()) assert.equal(await page.locator(".workspace-sidebar").count(), 1);
      if (await page.locator(".workspace").count())
        await ensure(page.locator('.workspace-nav [aria-current="page"]')).toBeInViewport({ ratio: 1 });
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
      const path = join(directory, label + "-" + name + ".png");
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      screenshots.push(path.slice(root.length));
    };
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await ensure(page.getByText("Ready", { exact: true }).first()).toBeVisible();
    const network = await page.evaluate(async url => {
      const response = await fetch(url + "/api/protocol");
      if (!response.ok) throw new Error("Public gateway unavailable");
      return response.json();
    }, gatewayUrl);
    assert(network.paidExecutionReady && network.networkMode === "mainnet" && network.chainId === 196);
    assert.equal(network.symbol, "USDC"); assert.equal(network.decimals, 6);
    assert.equal(network.token.toLowerCase(), engine.token.toLowerCase());
    assert.equal(network.vault.toLowerCase(), engine.contracts.vault.toLowerCase());
    const rpc = createPublicClient({ transport: http(rpcUrl) });
    assert.equal(await rpc.getChainId(), 196);
    assert.equal((await rpc.readContract({ address: network.vault, abi: parseAbi(["function token() view returns(address)"]), functionName: "token" })).toLowerCase(), engine.token.toLowerCase());
    assert.equal((await rpc.getBlock({ blockNumber: BigInt(network.anchor.blockNumber) })).hash, network.anchor.blockHash);
    assert.equal(await page.evaluate(url => fetch(url + "/api/account").then(response => response.status), gatewayUrl), 401);
    check("Public CORS, readiness, canonical RPC anchor, and account protection at " + name + " width");
    await page.getByRole("button", { name: "Soft limit reached", exact: true }).click();
    await ensure(page.getByText("Payment denied", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Customer override", exact: true }).click();
    await ensure(page.getByText("Payment allowed", { exact: true })).toBeVisible();
    await capture("landing");
    for (const [route, title] of [["dashboard", "Overview"], ["services", "Services"], ["playground", "Playground"], ["receipts", "Receipts"], ["policy", "Policy explorer"]]) {
      await page.goto(origin + "/" + route, { waitUntil: "domcontentloaded" });
      await ensure(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
      await ensure(page.getByText("Ready", { exact: true }).first()).toBeVisible();
      await ensure(page.locator('.workspace-nav [aria-current="page"]')).toBeInViewport({ ratio: 1 });
      assert.equal(await page.locator(".workspace-sidebar").count(), 1);
      if (route === "services") await ensure(page.getByText("Verified terms", { exact: true })).toHaveCount(2);
      if (["dashboard", "services"].includes(route)) await capture(route);
    }
    check("All five public workspace routes, service terms, and active navigation at " + name + " width");
    if (okxWallet) {
      await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
      const chooser = page.getByRole("dialog");
      await ensure(chooser.getByRole("heading", { name: "Choose your wallet", exact: true })).toBeVisible();
      await ensure(chooser.getByRole("button", { name: "OKX Wallet", exact: true })).toHaveCount(1);
      await ensure(chooser.getByRole("button", { name: "MetaMask", exact: true })).toBeVisible();
      await capture("wallet-chooser");
      await page.keyboard.press("Escape"); await ensure(chooser).not.toBeVisible();
      await ensure(page.getByRole("button", { name: "Connect wallet", exact: true }).first()).toBeFocused();
      check("Public OKX discovery, wallet chooser, and keyboard dismissal via " + (name === "desktop" ? "dedicated injection" : "EIP-6963 only") + " at " + name + " width");
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  check("No browser runtime errors or paid execution requests");
  const report = { kind: "anonymous-public-frontend-smoke", origin, gatewayUrl, rpcUrl,
    networkMode: "mainnet", currency: "USDC", token: engine.token, vault: engine.contracts.vault,
    walletMessageSignatures: 0, walletTransactions: 0, realAiRequests: 0,
    walletDiscovery: okxWallet ? "simulated dedicated OKX desktop and EIP-6963 mobile providers with MetaMask decoy; no permission requests" : "anonymous without wallet injection",
    checks, screenshots, checkedAt: new Date().toISOString() };
  await writeFile(join(root, "docs/evidence", artifactLabel ? `frontend-${artifactLabel}-public-checks.json` : "frontend-public-checks.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(process.env.EMETER_BROWSER_RESULT_PATH, JSON.stringify({ passed: true, checks: checks.length }) + "\n");
} catch (error) {
  await writeFile(process.env.EMETER_BROWSER_RESULT_PATH, JSON.stringify({ passed: false, error: error.message }) + "\n");
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
