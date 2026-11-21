import { createPublicClient, defineChain, http, numberToHex } from "viem";
import type { Address, EIP1193Provider, Hex } from "viem";
import type { GatewayNetwork } from "@emeter/sdk";

export const DEPLOYMENT = {
  chainId: 196,
  vault: "0x12412460847a865b29406fd8cd37df91dd881b50" as Address,
  registry: "0xec4839b1bdfac9450feeb211cf59a7cf075110f3" as Address,
  token: "0x66D16469E07217E53618887B492b14eA732b5a11" as Address,
  adapter: "0x87DB7961f425dDb39c54a8582D21f91a57C637B5" as Address,
  proofTransaction: "0x96fa8e32843b764fd069852346394b053be601adcf9c646d67eef674cf9c159c"
} as const;
export type BrowserWallet = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: BrowserWallet } }
export function paymentChain(rpcUrl: string) {
  return defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } } });
}
export function exactDemo(value: string, allowZero = false): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new Error("EXACT_DEMO_REQUIRED");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units > 2n ** 256n - 1n || (!allowZero && units === 0n)) throw new Error("INVALID_DEMO_AMOUNT");
  return units;
}
export function assertDeployment(network: GatewayNetwork) {
  for (const key of ["vault", "registry", "token"] as const)
    if (network[key].toLowerCase() !== DEPLOYMENT[key].toLowerCase()) throw new Error("DEPLOYMENT_MISMATCH");
  if (!network.anchor) throw new Error("GATEWAY_ANCHOR_UNAVAILABLE");
}
export async function assertRpcAnchor(network: GatewayNetwork, rpcUrl: string) {
  assertDeployment(network);
  const rpc = createPublicClient({ transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }) });
  if (await rpc.getChainId() !== 196) throw new Error("RPC_NETWORK_MISMATCH");
  const block = await rpc.getBlock({ blockNumber: BigInt(network.anchor!.blockNumber) }).catch(() => null);
  if (!block || block.hash?.toLowerCase() !== network.anchor!.blockHash.toLowerCase()) throw new Error("RPC_NETWORK_MISMATCH");
}
/** A fork and mainnet share chain ID 196. Check an exact canonical block before every wallet signature and transaction. */
export async function assertWalletAnchor(wallet: BrowserWallet, network: GatewayNetwork, address: Address) {
  assertDeployment(network);
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
