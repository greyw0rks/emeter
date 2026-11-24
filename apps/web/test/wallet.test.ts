import { describe, expect, it, vi } from "vitest";
import { assertDeployment, assertWalletAnchor, DEPLOYMENT, exactPayment } from "../lib/wallet";
import type { BrowserWallet } from "../lib/wallet";
import type { GatewayNetwork } from "@emeter/sdk";
import { X_LAYER_USDC } from "@emeter/shared";

const address = "0x0000000000000000000000000000000000000001" as const;
const hash = "0x" + "1".repeat(64);
const network: GatewayNetwork = { ...DEPLOYMENT, name: "emeter", phase: "paid-gateway", decimals: 6,
  mainnetProofVerified: true, paidExecutionReady: true, rpcUrl: "http://127.0.0.1:8545", confirmations: 1, networkMode: "local-fork",
  anchor: { blockNumber: "100", timestamp: "123", blockHash: hash as `0x${string}` } };
function wallet(answers: Record<string, unknown>) {
  return { request: vi.fn(async ({ method }: { method: string }) => answers[method]) } as unknown as BrowserWallet;
}
describe("exact USDC boundaries", () => {
  it.each([["0.000001", 1n], ["1", 1_000_000n], ["0.05", 50_000n], ["9007199254740993.123456", 9007199254740993123456n]] as const)("keeps %s exact", (value, units) => expect(exactPayment(value)).toBe(units));
  it.each(["0", "-1", "0.0000001", "1e6", "1,000", "01", " 1", ".5", "1.", "Infinity", (2n ** 256n).toString()])("refuses ambiguous or out-of-range %s", value => expect(() => exactPayment(value)).toThrow());
  it("permits a zero soft limit only when explicitly requested", () => expect(exactPayment("0", true)).toBe(0n));
});
describe("wallet network identity", () => {
  it("accepts a matching block on the same account and chain", async () => {
    const provider = wallet({ eth_chainId: "0xc4", eth_accounts: [address], eth_getBlockByNumber: { hash } });
    await assertWalletAnchor(provider, network, address);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_getBlockByNumber", params: ["0x64", false] });
  });
  it("refuses mainnet/fork hash differences even with chain ID 196", async () => {
    const provider = wallet({ eth_chainId: "0xc4", eth_accounts: [address], eth_getBlockByNumber: { hash: "0x" + "2".repeat(64) } });
    await expect(assertWalletAnchor(provider, network, address)).rejects.toThrow("WALLET_NETWORK_MISMATCH");
  });
  it("refuses a missing block", async () => {
    await expect(assertWalletAnchor(wallet({ eth_chainId: "0xc4", eth_accounts: [address], eth_getBlockByNumber: null }), network, address)).rejects.toThrow("WALLET_NETWORK_MISMATCH");
  });
  it("refuses another chain", async () => {
    await expect(assertWalletAnchor(wallet({ eth_chainId: "0x1", eth_accounts: [address], eth_getBlockByNumber: { hash } }), network, address)).rejects.toThrow("WALLET_CHAIN_MISMATCH");
  });
  it("refuses a changed selected account even if the previous account remains exposed", async () => {
    await expect(assertWalletAnchor(wallet({ eth_chainId: "0xc4", eth_accounts: [DEPLOYMENT.vault, address], eth_getBlockByNumber: { hash } }), network, address)).rejects.toThrow("WALLET_ACCOUNT_CHANGED");
  });
  it("refuses a substituted deployment", () => expect(() => assertDeployment({ ...network, vault: address })).toThrow("DEPLOYMENT_MISMATCH"));
  it("requires a gateway anchor", () => {
    const { anchor, ...unanchored } = network;
    expect(() => assertDeployment(unanchored)).toThrow("GATEWAY_ANCHOR_UNAVAILABLE");
  });
  it("accepts the explicitly configured USDC deployment and rejects a misleading currency", () => {
    const deployment = { ...DEPLOYMENT, token: X_LAYER_USDC.address, vault: address };
    const usdc: GatewayNetwork = { ...network, ...deployment, symbol: "USDC", networkMode: "mainnet" };
    expect(() => assertDeployment(usdc, deployment)).not.toThrow();
    expect(() => assertDeployment({ ...usdc, symbol: "DEMO" }, deployment)).toThrow("PAYMENT_TOKEN_MISMATCH");
    expect(() => assertDeployment({ ...usdc, token: DEPLOYMENT.token }, deployment)).toThrow("DEPLOYMENT_MISMATCH");
  });
});
