import { concatHex, keccak256, recoverMessageAddress, toHex } from "viem";
import type { Address, Hex } from "viem";

export * from "./payments.js";
export * from "./generated/engine-abi.js";
export * from "./json.js";
export * from "./gateway.js";
export * from "./ai-receipt.js";
export * from "./lifecycle.js";
export * from "./asset.js";
export * from "./deployment.js";

export const X_LAYER = {
  chainId: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrl: "https://rpc.xlayer.tech",
  factory: "0x1f09DAeFA827f02CBb40967cc91b259763760761",
  beacon: "0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C",
  explorerUrl: "https://www.oklink.com/xlayer"
} as const;

/** TAP-13 §5 exact wire digest. Hashes must come from the client's own request
 * and TAP-11 canonical JSON; this utility does not resolve service identity.
 */
export function tap13DigestFromHashes(input: {
  container: Address;
  idHash: Hex;
  requestHash: Hex;
  ok: boolean;
  bodyHash: Hex;
  ts: bigint;
}): Hex {
  if (input.ts < 0n || input.ts > 9_007_199_254_740_991n) throw new Error("Invalid TAP-13 timestamp");
  for (const hash of [input.idHash, input.requestHash, input.bodyHash]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Expected a 32-byte hash");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.container)) throw new Error("Invalid service container");
  return keccak256(concatHex([
    toHex("TAPI-1/resp/v2"), input.container, input.idHash, input.requestHash,
    input.ok ? "0x01" : "0x00", input.bodyHash, toHex(input.ts, { size: 8 })
  ]));
}

export function normalizeTap13Signature(signature: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Expected a 65-byte signature");
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const r = BigInt("0x" + signature.slice(2, 66));
  const s = BigInt("0x" + signature.slice(66, 130));
  let v = Number.parseInt(signature.slice(130), 16);
  if (v < 2) v += 27;
  if (r < 1n || r >= order || s < 1n || s > order / 2n || (v !== 27 && v !== 28)) {
    throw new Error("Invalid TAP-13 signature encoding");
  }
  return (signature.slice(0, 130) + v.toString(16)) as Hex;
}

export async function verifyTap13Hashes(
  input: Parameters<typeof tap13DigestFromHashes>[0],
  signature: Hex,
  resolvedSigner: Address
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message: { raw: tap13DigestFromHashes(input) },
      signature: normalizeTap13Signature(signature)
    });
    return recovered.toLowerCase() === resolvedSigner.toLowerCase();
  } catch {
    return false;
  }
}

export const chargeAuthorizationTypes = {
  ChargeAuthorization: [
    { name: "requestId", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "serviceId", type: "bytes32" },
    { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "overrideSoftLimit", type: "bool" }
  ]
} as const;

export const factoryAbi = [
  { type: "function", name: "cpuCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cpuAt", stateMutability: "view", inputs: [{ name: "i", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isCPU", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deployFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isSealed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;

export const processorAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "transistors", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nextId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "TAPEOUT_FEE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "circuitInfo", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ name: "nIn", type: "uint32" }, { name: "nOut", type: "uint32" }, { name: "nState", type: "uint32" }, { name: "gateCount", type: "uint32" }] },
  { type: "function", name: "netlist", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "eval", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "bytes" }], outputs: [{ type: "bytes" }] }
] as const;

export const beaconAbi = [{ type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
