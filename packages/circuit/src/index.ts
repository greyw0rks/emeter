import { hexToBytes, bytesToHex, keccak256 } from "viem";
import type { Hex } from "viem";

export const POLICY_INPUTS = [
  "serviceAuthorized", "receiptVerified", "chargeAuthorized",
  "sessionActive", "withinSoftLimit", "explicitOverride"
] as const;

export type PolicyInput = (typeof POLICY_INPUTS)[number];
export type PolicyFlags = Record<PolicyInput, boolean>;
export type NandGate = readonly [a: number, b: number];

export const POLICY_V1_GATES: readonly NandGate[] = [
  [6, 6],   // 8: !E
  [7, 7],   // 9: !F
  [8, 9],   // 10: E | F
  [2, 3],   // 11: !(A & B)
  [11, 11], // 12: A & B
  [4, 5],   // 13: !(C & D)
  [13, 13], // 14: C & D
  [12, 14], // 15: !(A & B & C & D)
  [15, 15], // 16: A & B & C & D
  [16, 10], // 17: !ALLOW
  [17, 17]  // 18: ALLOW
];

function assertPins(nIn: number, nOut: number) {
  if (!Number.isInteger(nIn) || nIn < 0 || nIn > 65_536) throw new Error("Invalid input count");
  if (!Number.isInteger(nOut) || nOut < 1 || nOut > 65_536) throw new Error("Invalid output count");
}

/** TAP-02 §2: opcode 0x00 followed by two big-endian u24 indices. */
export function encodeNandNetlist(gates: readonly NandGate[], nIn: number, nOut: number): Hex {
  assertPins(nIn, nOut);
  if (gates.length < nOut) throw new Error("Too few signals for outputs");
  if (2 + nIn + gates.length > 2 ** 24) throw new Error("Too many signals");
  const bytes = new Uint8Array(gates.length * 7);
  gates.forEach(([a, b], i) => {
    const nextSignal = 2 + nIn + i;
    for (const index of [a, b]) {
      if (!Number.isInteger(index) || index < 0 || index >= nextSignal) {
        throw new Error("NAND: future or invalid signal");
      }
    }
    const offset = i * 7;
    bytes[offset] = 0;
    bytes[offset + 1] = (a >>> 16) & 0xff;
    bytes[offset + 2] = (a >>> 8) & 0xff;
    bytes[offset + 3] = a & 0xff;
    bytes[offset + 4] = (b >>> 16) & 0xff;
    bytes[offset + 5] = (b >>> 8) & 0xff;
    bytes[offset + 6] = b & 0xff;
  });
  return bytesToHex(bytes);
}

/** This bounded compiler supports stateless NAND only, not LATCH or REF. */
export function decodeNandNetlist(netlist: Hex, nIn: number, nOut: number): NandGate[] {
  assertPins(nIn, nOut);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(netlist)) throw new Error("Invalid netlist hex");
  const bytes = hexToBytes(netlist);
  if (bytes.length % 7 !== 0) throw new Error("Truncated NAND record");
  if (bytes.length / 7 > 100_000) throw new Error("Compiler gate limit exceeded");
  const gates: NandGate[] = [];
  for (let offset = 0; offset < bytes.length; offset += 7) {
    if (bytes[offset] !== 0) throw new Error("Only stateless NAND records are supported");
    const a = bytes[offset + 1]! * 65_536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
    const b = bytes[offset + 4]! * 65_536 + bytes[offset + 5]! * 256 + bytes[offset + 6]!;
    gates.push([a, b]);
  }
  encodeNandNetlist(gates, nIn, nOut);
  return gates;
}

/** TAP-02 §4–5: constants at 0/1, last nOut signals, LSB-first packed bits.
 * Inputs are read leniently like the deployed processor: missing bits are 0.
 */
export function evaluateNandNetlist(netlist: Hex, nIn: number, nOut: number, inputs: Hex): Hex {
  const gates = decodeNandNetlist(netlist, nIn, nOut);
  const inputBytes = hexToBytes(inputs);
  const signals = [false, true];
  for (let bit = 0; bit < nIn; bit++) {
    signals.push(((inputBytes[Math.floor(bit / 8)] ?? 0) & (1 << (bit % 8))) !== 0);
  }
  for (const [a, b] of gates) signals.push(!(signals[a]! && signals[b]!));
  const output = new Uint8Array(Math.ceil(nOut / 8));
  for (let bit = 0; bit < nOut; bit++) {
    if (signals[signals.length - nOut + bit]) output[Math.floor(bit / 8)]! |= 1 << (bit % 8);
  }
  return bytesToHex(output);
}

export function packPolicyInputs(flags: PolicyFlags): Hex {
  return bytesToHex(Uint8Array.of(POLICY_INPUTS.reduce((mask, key, bit) => mask | (flags[key] ? 1 << bit : 0), 0)));
}

export function flagsFromMask(mask: number): PolicyFlags {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) throw new Error("Policy mask must be a six-bit integer");
  return Object.fromEntries(POLICY_INPUTS.map((key, bit) => [key, (mask & (1 << bit)) !== 0])) as PolicyFlags;
}

export function policyDecision(flags: PolicyFlags): boolean {
  return flags.serviceAuthorized && flags.receiptVerified && flags.chargeAuthorized &&
    flags.sessionActive && (flags.withinSoftLimit || flags.explicitOverride);
}

export const POLICY_V1 = {
  name: "emeter-payment-policy-v1",
  specification: "TAP-02@527477ecb7cf68ee9e86d8292669d57fe1680572",
  expression: "A AND B AND C AND D AND (E OR F)",
  nIn: 6, nOut: 1, nState: 0, gateCount: POLICY_V1_GATES.length,
  netlist: encodeNandNetlist(POLICY_V1_GATES, 6, 1)
} as const;

export const POLICY_V1_NETLIST_HASH = keccak256(POLICY_V1.netlist);

export function policyArtifact() {
  return {
    ...POLICY_V1,
    netlistHash: POLICY_V1_NETLIST_HASH,
    inputs: POLICY_INPUTS,
    truthTable: Array.from({ length: 64 }, (_, mask) => {
      const flags = flagsFromMask(mask);
      return { mask, inputs: packPolicyInputs(flags), outputs: policyDecision(flags) ? "0x01" : "0x00" };
    })
  };
}
