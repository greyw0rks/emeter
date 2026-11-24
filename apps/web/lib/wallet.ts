import { createPublicClient, defineChain, http, numberToHex, parseAbi } from "viem";
import type { Address, EIP1193Provider, Hex } from "viem";
import type { GatewayNetwork } from "@emeter/sdk";
import { X_LAYER, LEGACY_DEPLOYMENT, paymentAsset } from "@emeter/shared";
import type { PaymentDeployment } from "@emeter/shared";

/** Historical circuit proof only. Payment destinations come from /api/config. */
export const DEPLOYMENT = LEGACY_DEPLOYMENT;
export type BrowserWallet = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  providers?: BrowserWallet[];
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isMetaMask?: boolean;
};
declare global { interface Window { ethereum?: BrowserWallet; okxwallet?: BrowserWallet } }
export type WalletChoice = { id: string; name: string; provider: BrowserWallet };
export function mergeWalletChoices(current: WalletChoice[], incoming: WalletChoice[]) {
  const result = [...current];
  for (const choice of incoming) {
    if (!result.some(existing => existing.provider === choice.provider || existing.id === choice.id)) result.push(choice);
  }
  return result;
}
export function injectedWallets(browser: { ethereum?: BrowserWallet; okxwallet?: BrowserWallet }): WalletChoice[] {
  const choices: WalletChoice[] = [];
  if (typeof browser.okxwallet?.request === "function") choices.push({ id: "okx", name: "OKX Wallet", provider: browser.okxwallet });
  const providers = browser.ethereum?.providers ?? (browser.ethereum ? [browser.ethereum] : []);
  return mergeWalletChoices(choices, providers.filter(provider => typeof provider?.request === "function").map((provider, index) => {
    const okx = provider.isOkxWallet || provider.isOKExWallet;
    return { id: okx ? "okx" : provider.isMetaMask ? "metamask" : `injected-${index}`,
      name: okx ? "OKX Wallet" : provider.isMetaMask ? "MetaMask" : "Browser wallet", provider };
  }));
}
export function announcedWallet(value: unknown): WalletChoice | undefined {
  if (!value || typeof value !== "object") return;
  const { info, provider } = value as { info?: { name?: unknown; rdns?: unknown; uuid?: unknown }; provider?: BrowserWallet };
  if (!info || typeof info.name !== "string" || info.name.length > 100 || typeof provider?.request !== "function") return;
  const rawId = typeof info.rdns === "string" ? info.rdns : info.uuid;
  if (typeof rawId !== "string" || !rawId || rawId.length > 200) return;
  const okx = provider.isOkxWallet || provider.isOKExWallet || /okx|okex/i.test(info.name + " " + rawId);
  return { id: okx ? "okx" : rawId === "io.metamask" ? "metamask" : rawId, name: okx ? "OKX Wallet" : info.name, provider };
}
export function walletErrorCode(error: unknown): number | undefined {
  const seen = new Set<unknown>(), queue = [error];
  let fallback: number | undefined;
  for (let count = 0; queue.length && count < 16; count++) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const record = value as { code?: unknown; cause?: unknown; error?: unknown; data?: { originalError?: unknown } };
    const code = typeof record.code === "number" ? record.code : typeof record.code === "string" && /^-?\d+$/.test(record.code) ? Number(record.code) : undefined;
    if (code !== undefined) {
      if ([4001, 4902, -32002].includes(code)) return code;
      fallback ??= code;
    }
    queue.push(record.cause, record.error, record.data?.originalError);
  }
  return fallback;
}
export function walletRejected(error: unknown) {
  return walletErrorCode(error) === 4001 || error instanceof Error && /user.*(?:reject|den(?:y|ied))|(?:reject|den(?:y|ied)).*user/i.test(error.message);
}
export async function walletStage<T>(stage: "CONNECTION" | "NETWORK" | "SIGN_IN", action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (walletRejected(error)) throw new Error(`WALLET_${stage}_DECLINED`);
    if (walletErrorCode(error) === -32002) throw new Error("WALLET_REQUEST_PENDING");
    throw error;
  }
}
export async function ensureWalletChain(wallet: BrowserWallet, network: GatewayNetwork) {
  if (Number(await wallet.request({ method: "eth_chainId" })) === 196) return;
  if (network.networkMode !== "mainnet") throw new Error("WALLET_CHAIN_MISMATCH");
  await walletStage("NETWORK", async () => {
    try { await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4" }] }); }
    catch (error) {
      if (walletErrorCode(error) !== 4902) throw error;
      await wallet.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0xc4", chainName: X_LAYER.name,
        nativeCurrency: X_LAYER.nativeCurrency, rpcUrls: [X_LAYER.rpcUrl], blockExplorerUrls: [X_LAYER.explorerUrl] }] });
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4" }] });
    }
    if (Number(await wallet.request({ method: "eth_chainId" })) !== 196) throw new Error("WALLET_CHAIN_MISMATCH");
  });
}
export function paymentChain(rpcUrl: string) {
  return defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } } });
}
export function exactPayment(value: string, allowZero = false): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new Error("EXACT_PAYMENT_REQUIRED");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units > 2n ** 256n - 1n || (!allowZero && units === 0n)) throw new Error("INVALID_PAYMENT_AMOUNT");
  return units;
}
export function assertDeployment(network: GatewayNetwork, expected: PaymentDeployment = DEPLOYMENT) {
  for (const key of ["vault", "registry", "token"] as const)
    if (network[key].toLowerCase() !== expected[key].toLowerCase()) throw new Error("DEPLOYMENT_MISMATCH");
  const asset = paymentAsset(network.token);
  if (network.decimals !== asset.decimals || network.symbol && network.symbol !== asset.symbol) throw new Error("PAYMENT_TOKEN_MISMATCH");
  if (asset.symbol === "DEMO" && network.networkMode !== "local-fork") throw new Error("DEMO_REQUIRES_LOCAL_FORK");
  if (!network.anchor) throw new Error("GATEWAY_ANCHOR_UNAVAILABLE");
}
export async function assertRpcAnchor(network: GatewayNetwork, rpcUrl: string, expected: PaymentDeployment = DEPLOYMENT) {
  assertDeployment(network, expected);
  const rpc = createPublicClient({ transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }) });
  if (await rpc.getChainId() !== 196) throw new Error("RPC_NETWORK_MISMATCH");
  const block = await rpc.getBlock({ blockNumber: BigInt(network.anchor!.blockNumber) }).catch(() => null);
  if (!block || block.hash?.toLowerCase() !== network.anchor!.blockHash.toLowerCase()) throw new Error("RPC_NETWORK_MISMATCH");
  const [token, registry, adapter, decimals] = await Promise.all([
    rpc.readContract({ address: expected.vault, abi: parseAbi(["function token() view returns(address)"]), functionName: "token", blockNumber: block.number }),
    rpc.readContract({ address: expected.vault, abi: parseAbi(["function registry() view returns(address)"]), functionName: "registry", blockNumber: block.number }),
    rpc.readContract({ address: expected.vault, abi: parseAbi(["function adapter() view returns(address)"]), functionName: "adapter", blockNumber: block.number }),
    rpc.readContract({ address: expected.token, abi: parseAbi(["function decimals() view returns(uint8)"]), functionName: "decimals", blockNumber: block.number }),
  ]);
  if (token.toLowerCase() !== expected.token.toLowerCase() || registry.toLowerCase() !== expected.registry.toLowerCase()
    || adapter.toLowerCase() !== expected.adapter.toLowerCase() || decimals !== network.decimals) throw new Error("PAYMENT_TOKEN_MISMATCH");
}
/** A fork and mainnet share chain ID 196. Check an exact canonical block before every wallet signature and transaction. */
export async function assertWalletAnchor(wallet: BrowserWallet, network: GatewayNetwork, address: Address, expected: PaymentDeployment = DEPLOYMENT) {
  assertDeployment(network, expected);
  const [chainId, accounts, block] = await Promise.all([
    wallet.request({ method: "eth_chainId" }), wallet.request({ method: "eth_accounts" }),
    wallet.request({ method: "eth_getBlockByNumber", params: [numberToHex(BigInt(network.anchor!.blockNumber)), false] }).catch(() => null)
  ]);
  if (Number(chainId) !== 196) throw new Error("WALLET_CHAIN_MISMATCH");
  if (accounts[0]?.toLowerCase() !== address.toLowerCase()) throw new Error("WALLET_ACCOUNT_CHANGED");
  if (!block || block.hash?.toLowerCase() !== network.anchor!.blockHash.toLowerCase()) throw new Error("WALLET_NETWORK_MISMATCH");
}
export function randomNonce() {
  return BigInt("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""));
}
export type PendingTransaction = { hash: Hex | null; label: string; from: Address; to: Address; dataHash: Hex; rpcUrl: string; mode: "mainnet" | "local-fork" };
export function publicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("INVALID_PUBLIC_CONFIGURATION");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("INVALID_PUBLIC_CONFIGURATION");
  return url.href.replace(/\/$/, "");
}
