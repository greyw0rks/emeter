import { describe, expect, it, vi } from "vitest";
import { announcedWallet, ensureWalletChain, injectedWallets, mergeWalletChoices, walletErrorCode, walletStage } from "../lib/wallet";
import type { BrowserWallet } from "../lib/wallet";
import type { GatewayNetwork } from "@emeter/sdk";
import { errorMessage } from "../lib/errors";

const provider = (flags: Partial<BrowserWallet> = {}) => ({ request: vi.fn(), ...flags }) as unknown as BrowserWallet;
describe("injected wallet selection", () => {
  it("finds OKX's dedicated provider even when Ethereum belongs to MetaMask", () => {
    const okx = provider(), metamask = provider({ isMetaMask: true });
    const choices = injectedWallets({ okxwallet: okx, ethereum: metamask });
    expect(choices.map(c => c.name)).toEqual(["OKX Wallet", "MetaMask"]);
    expect(choices[0]!.provider).toBe(okx);
    expect(okx.request).not.toHaveBeenCalled();
    expect(metamask.request).not.toHaveBeenCalled();
  });
  it("supports OKX without window.ethereum", () => expect(injectedWallets({ okxwallet: provider() })[0]?.id).toBe("okx"));
  it("deduplicates OKX's aliases while keeping a distinct second wallet", () => {
    const okx = provider({ isOkxWallet: true }), other = provider({ isMetaMask: true });
    expect(injectedWallets({ okxwallet: okx, ethereum: provider({ providers: [okx, other] }) })).toHaveLength(2);
  });
  it("merges EIP-6963 announcements without duplicate providers or loading wallet icons", () => {
    const okx = provider();
    const announced = announcedWallet({ info: { uuid: "okx-one", rdns: "com.okex.wallet", name: "OKX Wallet", icon: "https://untrusted.invalid/icon.svg" }, provider: okx })!;
    expect(announced).toEqual({ id: "okx", name: "OKX Wallet", provider: okx });
    expect(mergeWalletChoices(injectedWallets({ okxwallet: okx }), [announced])).toHaveLength(1);
  });
  it("rejects malformed announcements", () => {
    expect(announcedWallet({ info: { name: "OKX", rdns: "com.okex.wallet" }, provider: {} })).toBeUndefined();
    expect(announcedWallet({ provider: provider() })).toBeUndefined();
  });
});
describe("wallet connection errors", () => {
  it("distinguishes connection refusal from sign-in signature refusal", async () => {
    for (const stage of ["CONNECTION", "SIGN_IN"] as const) {
      await expect(walletStage(stage, async () => { throw { code: 4001 }; })).rejects.toThrow(`WALLET_${stage}_DECLINED`);
    }
    expect(errorMessage(new Error("WALLET_SIGN_IN_DECLINED"))).toContain("wallet is connected");
  });
  it("extracts nested wallet errors behind an internal RPC error", () => {
    expect(walletErrorCode({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(4902);
    expect(walletErrorCode({ cause: { code: "4001" } })).toBe(4001);
  });
  it("names a pending permission request instead of calling it a refusal", async () => {
    await expect(walletStage("CONNECTION", async () => { throw { code: -32002 }; })).rejects.toThrow("WALLET_REQUEST_PENDING");
    expect(errorMessage({ code: -32002 })).toContain("request waiting");
  });
  it("does not mislabel rejected evidence as user cancellation", () => {
    expect(errorMessage(new Error("Rejected invalid signature"))).not.toContain("wallet request was declined");
  });
});
describe("X Layer selection", () => {
  const mainnet = { networkMode: "mainnet" } as GatewayNetwork;
  it("switches mainnet wallets to chain196 and verifies the change", async () => {
    let chain = "0x1";
    const request = vi.fn(async ({ method }: { method: string }) => { if (method === "wallet_switchEthereumChain") chain = "0xc4"; return chain; });
    await ensureWalletChain({ request } as unknown as BrowserWallet, mainnet);
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4" }] });
    expect(request).toHaveBeenLastCalledWith({ method: "eth_chainId" });
  });
  it("adds only the pinned official mainnet RPC for unknown-chain errors", async () => {
    let chain = "0x1", registered = false;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_switchEthereumChain") { if (!registered) throw { code: -32603, data: { originalError: { code: 4902 } } }; chain = "0xc4"; }
      if (method === "wallet_addEthereumChain") registered = true;
      return chain;
    });
    await ensureWalletChain({ request } as unknown as BrowserWallet, mainnet);
    expect(request).toHaveBeenCalledWith({ method: "wallet_addEthereumChain", params: [expect.objectContaining({ chainId: "0xc4", rpcUrls: ["https://rpc.xlayer.tech"] })] });
  });
  it("never substitutes a mainnet RPC for a local fork", async () => {
    const request = vi.fn(async () => "0x1");
    await expect(ensureWalletChain({ request } as unknown as BrowserWallet, { networkMode: "local-fork" } as GatewayNetwork)).rejects.toThrow("WALLET_CHAIN_MISMATCH");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not add a chain after a user declined a network switch", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x1"; throw { code: 4001 }; });
    await expect(ensureWalletChain({ request } as unknown as BrowserWallet, mainnet)).rejects.toThrow("WALLET_NETWORK_DECLINED");
    expect(request.mock.calls.some(([call]) => call.method === "wallet_addEthereumChain")).toBe(false);
  });
});
