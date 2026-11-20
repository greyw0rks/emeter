import { expect, it, vi } from "vitest";
import { EmeterClient } from "../src/index.js";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

it("rejects an invalid gateway response instead of implying readiness", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ paidExecutionReady: true })));
  const client = new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher });
  await expect(client.getProtocolStatus()).rejects.toThrow();
});

it("does not sign a challenge for another origin or wallet", async () => {
  const identity = privateKeyToAccount(generatePrivateKey());
  const sign = vi.spyOn(identity, "signMessage");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: crypto.randomUUID(),
    message: "emeter authentication for another origin", expiresAt: new Date(Date.now() + 300_000).toISOString() })));
  await expect(new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher }).authenticate(identity)).rejects.toThrow("challenge");
  expect(sign).not.toHaveBeenCalled();
});

it.each(["1e-2", "0.0000001", "-1", " 1", "01", "NaN"])("rejects inexact maximum charge %s before HTTP", async maxCharge => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher,
    token: "fixture-token", sessionId: keccak256(toHex("fixture-session")) });
  await expect(client.execute({ serviceId: "json-validator", input: {}, maxCharge })).rejects.toThrow("exact DEMO decimal");
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects plaintext public credential transport and credentials embedded in URLs", () => {
  expect(() => new EmeterClient({ gatewayUrl: "http://api.example.com" })).toThrow("HTTPS");
  expect(() => new EmeterClient({ gatewayUrl: "https://user:password@api.example.com" })).toThrow();
});

it("does not send a paid request when readiness is false", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ name: "emeter", phase: "paid-gateway",
    chainId: 196, paidExecutionReady: false, mainnetProofVerified: true, vault: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002", token: "0x0000000000000000000000000000000000000003",
    rpcUrl: "https://rpc.xlayer.tech", decimals: 6, confirmations: 3, networkMode: "mainnet" })));
  const client = new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher,
    token: "fixture-token", sessionId: keccak256(toHex("fixture-session")) });
  await expect(client.execute({ serviceId: "json-validator", input: {}, maxCharge: "0.02" })).rejects.toThrow("GATEWAY_NOT_READY");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("propagates a gateway failure", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
  await expect(new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher }).getProtocolStatus()).rejects.toThrow("503");
});
