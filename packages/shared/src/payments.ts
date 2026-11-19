import { z } from "zod";
import { encodeAbiParameters, getAddress, hashTypedData, keccak256 } from "viem";
import type { Address, Hex } from "viem";

export const PAYMENT_CHAIN_ID = 196;
export const MAX_SESSION_DURATION_SECONDS = 30n * 24n * 60n * 60n;
export const MAX_SETTLEMENT_WINDOW_SECONDS = 24n * 60n * 60n;
export const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;
const nonzeroHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine(value => value.toLowerCase() !== ZERO_BYTES32).transform(value => value as Hex);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value)).transform(value => getAddress(value));
const uint256 = z.bigint().min(0n).max((1n << 256n) - 1n);
const uint64 = z.bigint().min(0n).max((1n << 64n) - 1n);

export const SessionAuthorizationSchema = z.object({
  customer: address, signer: address, budget: uint256.min(1n), softLimit: uint256,
  maxCharge: uint256.min(1n), expiresAt: uint64, settlementWindow: uint64.min(1n).max(MAX_SETTLEMENT_WINDOW_SECONDS),
  serviceSetHash: nonzeroHash, nonce: uint256
}).strict().superRefine((value, ctx) => {
  if (value.softLimit > value.budget || value.maxCharge > value.budget) ctx.addIssue({ code: "custom", message: "Session limits exceed budget" });
});
export type SessionAuthorization = z.infer<typeof SessionAuthorizationSchema>;

export const SessionChargeAuthorizationSchema = z.object({
  sessionId: nonzeroHash, requestId: nonzeroHash, requestHash: nonzeroHash, serviceId: nonzeroHash,
  priceVersion: z.number().int().min(1).max(2 ** 32 - 1), maxAmount: uint256.min(1n),
  nonce: uint256, issuedAt: uint64, validUntil: uint64
}).strict().refine(value => value.validUntil >= value.issuedAt, "Charge expires before issuance");
export type SessionChargeAuthorization = z.infer<typeof SessionChargeAuthorizationSchema>;

export const SoftLimitOverrideSchema = z.object({
  sessionId: nonzeroHash, chargeDigest: nonzeroHash, maxTotalSpend: uint256.min(1n), validUntil: uint64
}).strict();
export type SoftLimitOverride = z.infer<typeof SoftLimitOverrideSchema>;

export const sessionAuthorizationTypes = {
  SessionAuthorization: [
    { name: "customer", type: "address" }, { name: "signer", type: "address" },
    { name: "budget", type: "uint256" }, { name: "softLimit", type: "uint256" },
    { name: "maxCharge", type: "uint256" }, { name: "expiresAt", type: "uint64" },
    { name: "settlementWindow", type: "uint64" }, { name: "serviceSetHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
} as const;
export const sessionChargeAuthorizationTypes = {
  ChargeAuthorization: [
    { name: "sessionId", type: "bytes32" }, { name: "requestId", type: "bytes32" },
    { name: "requestHash", type: "bytes32" }, { name: "serviceId", type: "bytes32" },
    { name: "priceVersion", type: "uint32" }, { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "issuedAt", type: "uint64" }, { name: "validUntil", type: "uint64" }
  ]
} as const;
export const softLimitOverrideTypes = {
  SoftLimitOverride: [
    { name: "sessionId", type: "bytes32" }, { name: "chargeDigest", type: "bytes32" },
    { name: "maxTotalSpend", type: "uint256" }, { name: "validUntil", type: "uint64" }
  ]
} as const;

export function vaultDomain(vault: Address, chainId = PAYMENT_CHAIN_ID) {
  if (chainId !== PAYMENT_CHAIN_ID) throw new Error("emeter supports X Layer chain 196");
  return { name: "emeter Vault", version: "1", chainId, verifyingContract: getAddress(vault) } as const;
}

export function canonicalServiceIds(ids: readonly Hex[]): Hex[] {
  if (ids.length === 0 || ids.length > 16) throw new Error("Select between one and sixteen services");
  const parsed = ids.map(id => nonzeroHash.parse(id).toLowerCase() as Hex).sort();
  if (new Set(parsed).size !== parsed.length) throw new Error("Duplicate service IDs");
  return parsed;
}

export function serviceSetHash(ids: readonly Hex[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [canonicalServiceIds(ids)]));
}

export function sessionIdFor(vault: Address, customer: Address, nonce: bigint): Hex {
  uint256.parse(nonce);
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [getAddress(vault), 196n, getAddress(customer), nonce]
  ));
}

export function sessionSigningPayload(vault: Address, grant: SessionAuthorization) {
  return { domain: vaultDomain(vault), types: sessionAuthorizationTypes, primaryType: "SessionAuthorization" as const,
    message: SessionAuthorizationSchema.parse(grant) };
}
export function chargeSigningPayload(vault: Address, charge: SessionChargeAuthorization) {
  return { domain: vaultDomain(vault), types: sessionChargeAuthorizationTypes, primaryType: "ChargeAuthorization" as const,
    message: SessionChargeAuthorizationSchema.parse(charge) };
}
export function overrideSigningPayload(vault: Address, grant: SoftLimitOverride) {
  return { domain: vaultDomain(vault), types: softLimitOverrideTypes, primaryType: "SoftLimitOverride" as const,
    message: SoftLimitOverrideSchema.parse(grant) };
}
export function sessionChargeDigest(vault: Address, charge: SessionChargeAuthorization): Hex {
  return hashTypedData(chargeSigningPayload(vault, charge));
}
