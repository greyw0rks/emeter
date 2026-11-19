import { expect, it } from "vitest";
import { hashTypedData, keccak256, toHex } from "viem";
import type { Address } from "viem";
import { SessionAuthorizationSchema, SessionChargeAuthorizationSchema, canonicalServiceIds,
  chargeSigningPayload, serviceSetHash, sessionChargeDigest, sessionIdFor, sessionSigningPayload, vaultDomain } from "../src/payments.js";

const vault = "0x0000000000000000000000000000000000000001" as Address;
const customer = "0x0000000000000000000000000000000000000002" as Address;
const signer = "0x0000000000000000000000000000000000000003" as Address;
const services = [keccak256(toHex("service-b")), keccak256(toHex("service-a"))];
const grant = { customer, signer, budget: 200_000n, softLimit: 50_000n, maxCharge: 50_000n,
  expiresAt: 1_900_000_000n, settlementWindow: 300n, serviceSetHash: serviceSetHash(services), nonce: 1n };

it("canonicalizes a signed service set and rejects ambiguous duplicate entries", () => {
  expect(serviceSetHash(services)).toBe(serviceSetHash([...services].reverse()));
  expect(canonicalServiceIds(services)).toEqual([...services].sort());
  expect(() => canonicalServiceIds([services[0]!, services[0]!])).toThrow();
  expect(() => canonicalServiceIds([])).toThrow();
});

it("bounds session money and timestamps without floating point", () => {
  expect(SessionAuthorizationSchema.parse(grant).budget).toBe(200_000n);
  expect(() => SessionAuthorizationSchema.parse({ ...grant, budget: 0.2 })).toThrow();
  expect(() => SessionAuthorizationSchema.parse({ ...grant, maxCharge: 200_001n })).toThrow();
  expect(() => SessionAuthorizationSchema.parse({ ...grant, softLimit: 200_001n })).toThrow();
  expect(() => SessionAuthorizationSchema.parse({ ...grant, settlementWindow: 86_401n })).toThrow();
});

it("binds the customer capability to every limit, service set, key, and nonce", () => {
  const original = hashTypedData(sessionSigningPayload(vault, grant));
  for (const change of [{ budget: 200_001n }, { softLimit: 49_999n }, { maxCharge: 49_999n },
    { nonce: 2n }, { signer: customer }, { serviceSetHash: serviceSetHash([services[0]!]) }]) {
    expect(hashTypedData(sessionSigningPayload(vault, { ...grant, ...change }))).not.toBe(original);
  }
});

it("uses distinct session IDs across vaults, customers, and grant nonces", () => {
  const id = sessionIdFor(vault, customer, 1n);
  expect(sessionIdFor(vault, customer, 2n)).not.toBe(id);
  expect(sessionIdFor(customer, customer, 1n)).not.toBe(id);
  expect(sessionIdFor(vault, signer, 1n)).not.toBe(id);
  expect(() => vaultDomain(vault, 1)).toThrow();
});

it("binds each charge to its session, price version, request hash, cap, and deadline", () => {
  const charge = { sessionId: sessionIdFor(vault, customer, 1n), requestId: keccak256(toHex("req")),
    requestHash: keccak256(toHex("request body")), serviceId: services[0]!, priceVersion: 1,
    maxAmount: 20_000n, nonce: 1n, issuedAt: 100n, validUntil: 200n };
  const original = sessionChargeDigest(vault, charge);
  for (const change of [{ priceVersion: 2 }, { maxAmount: 20_001n }, { nonce: 2n }, { validUntil: 201n },
    { requestHash: keccak256(toHex("other input")) }, { sessionId: sessionIdFor(vault, customer, 2n) }]) {
    expect(hashTypedData(chargeSigningPayload(vault, { ...charge, ...change }))).not.toBe(original);
  }
  expect(() => SessionChargeAuthorizationSchema.parse({ ...charge, validUntil: 99n })).toThrow();
  expect(() => SessionChargeAuthorizationSchema.parse({ ...charge, maxAmount: 0.02 })).toThrow();
  expect(() => SessionChargeAuthorizationSchema.parse({ ...charge, priceVersion: 1.5 })).toThrow();
});
