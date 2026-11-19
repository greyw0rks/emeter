import { beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, recoverTypedDataAddress, toHex } from "viem";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { emeterVaultAbi, serviceSetHash, sessionIdFor } from "@emeter/shared";
import { EmeterSessionClient } from "../src/session-client.js";

const { chainId, readContract, getBlock } = vi.hoisted(() => ({ chainId: vi.fn(), readContract: vi.fn(), getBlock: vi.fn() }));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: vi.fn(() => ({ getChainId: chainId, readContract, getBlock }))
}));

const vault = "0x0000000000000000000000000000000000000001" as Address;
const registry = "0x0000000000000000000000000000000000000002" as Address;
const customer = privateKeyToAccount(generatePrivateKey());
const delegate = privateKeyToAccount(generatePrivateKey());
const service = keccak256(toHex("sdk-service"));
const sessionId = sessionIdFor(vault, customer.address, 1n);
const session = { customer: customer.address, signer: delegate.address, budget: 200_000n, balance: 200_000n,
  spent: 20_000n, refundedAmount: 0n, softLimit: 50_000n, maxCharge: 50_000n, createdAt: 50n,
  expiresAt: 1000n, executionDeadline: 1000n, refundAfter: 1300n, settlementWindow: 300n, status: 1, signerRevoked: false };
const client = new EmeterSessionClient({ rpcUrl: "https://rpc.example.invalid", vault, registry });

beforeEach(() => {
  chainId.mockResolvedValue(196);
  getBlock.mockResolvedValue({ timestamp: 100n });
  readContract.mockImplementation(async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    if (functionName === "getService") return { provider: customer.address, enabled: true, latestVersion: 2 };
    if (functionName === "getPriceVersion") return { payout: customer.address, signer: customer.address,
      container: registry, price: args[1] === 1 ? 20_000n : 30_000n, metadataHash: service, createdAt: 50n, enabled: true };
    if (functionName === "getSession") return session;
    if (functionName === "availableBalance") return 200_000n;
    if (functionName === "isServiceAuthorized" || functionName === "sessionServiceAllowed") return true;
    if (functionName === "consumedSessionNonces" || functionName === "consumedChargeNonces") return false;
    throw new Error("Unexpected SDK chain read");
  });
});

it("refuses a signing flow connected to another network", async () => {
  chainId.mockResolvedValue(1);
  await expect(client.getQuote(service)).rejects.toThrow("chain 196");
});

it("uses an explicitly signed old version after a price update", async () => {
  expect((await client.getQuote(service, 1)).price).toBe(20_000n);
  expect((await client.getQuote(service)).price).toBe(30_000n);
});

it("builds a customer-signed, capped session transaction", async () => {
  const prepared = await client.prepareSession({ customer: customer.address, signer: delegate.address, budget: 200_000n,
    softLimit: 50_000n, maxCharge: 50_000n, expiresAt: 1000n, settlementWindow: 300n,
    serviceSetHash: serviceSetHash([service]), nonce: 1n }, [service]);
  const signed = await client.signSession(prepared, customer);
  expect(await recoverTypedDataAddress({ ...signed.typedData, signature: signed.signature })).toBe(customer.address);
  const decoded = decodeFunctionData({ abi: emeterVaultAbi, data: signed.transaction.data });
  expect(decoded.functionName).toBe("createSession");
  expect(prepared.sessionId).toBe(sessionId);
});

it("signs a scoped charge and requires a separate customer override", async () => {
  const prepared = await client.prepareCharge({ sessionId, serviceId: service, priceVersion: 2,
    requestId: keccak256(toHex("request")), requestHash: keccak256(toHex("request body")), nonce: 1n });
  const signed = await client.signCharge(prepared, delegate);
  expect(await recoverTypedDataAddress({ ...signed.typedData, signature: signed.signature })).toBe(delegate.address);
  expect(signed.authorization.priceVersion).toBe(2);
  expect(signed.requiresCustomerOverride).toBe(false);
  const override = await client.signOverride(signed.authorization, 50_000n, 1300n, customer);
  expect(await recoverTypedDataAddress({ ...override.typedData, signature: override.signature })).toBe(customer.address);
});

it("rejects a request exceeding the delegated per-request cap", async () => {
  await expect(client.prepareCharge({ sessionId, serviceId: service, requestId: service,
    requestHash: service, nonce: 1n, maxAmount: 50_001n })).rejects.toThrow("signed maximum");
});

it("refuses to sign a customer override beyond the session budget", async () => {
  const prepared = await client.prepareCharge({ sessionId, serviceId: service, requestId: service,
    requestHash: service, nonce: 1n });
  await expect(client.signOverride(prepared.authorization, 200_001n, 1300n, customer)).rejects.toThrow("budget");
});

it("refuses new authorizations for a closing session", async () => {
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "getSession") return { ...session, status: 2 };
    if (functionName === "getService") return { provider: customer.address, enabled: true, latestVersion: 1 };
    if (functionName === "getPriceVersion") return { price: 20_000n };
    if (functionName === "isServiceAuthorized" || functionName === "sessionServiceAllowed") return true;
    return false;
  });
  await expect(client.prepareCharge({ sessionId, serviceId: service, requestId: service,
    requestHash: service, nonce: 1n })).rejects.toThrow("not accepting");
});
