import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POLICY_V1, POLICY_V1_NETLIST_HASH, decodeNandNetlist, encodeNandNetlist, evaluateNandNetlist, flagsFromMask, packPolicyInputs, policyArtifact, policyDecision } from "../src/index.js";

describe("emeter stateless NAND policy", () => {
  for (let mask = 0; mask < 64; mask++) {
    it(`evaluates input ${mask.toString(2).padStart(6, "0")} against the policy truth table`, () => {
      const flags = flagsFromMask(mask);
      const expected = (mask & 15) === 15 && (mask & 48) !== 0;
      expect(policyDecision(flags)).toBe(expected);
      expect(evaluateNandNetlist(POLICY_V1.netlist, 6, 1, packPolicyInputs(flags))).toBe(expected ? "0x01" : "0x00");
    });
  }

  it("uses exactly 11 NAND records, 77 bytes, and three allowing inputs", () => {
    expect(decodeNandNetlist(POLICY_V1.netlist, 6, 1)).toHaveLength(11);
    expect(POLICY_V1.netlist.length).toBe(2 + 77 * 2);
    expect(policyArtifact().truthTable.filter(v => v.outputs === "0x01").map(v => v.mask)).toEqual([31, 47, 63]);
  });

  it("keeps generated JSON and Solidity pinned to identical bytes", () => {
    const artifact = JSON.parse(readFileSync(new URL("../artifacts/policy-v1.json", import.meta.url), "utf8"));
    expect(artifact).toEqual(policyArtifact());
    const solidity = readFileSync(new URL("../../contracts/src/generated/EmeterPolicyV1.sol", import.meta.url), "utf8");
    expect(solidity).toContain(POLICY_V1.netlist.slice(2));
    expect(solidity).toContain(POLICY_V1_NETLIST_HASH);
  });

  it("follows TAP-02 lenient input length and padding semantics", () => {
    expect(evaluateNandNetlist(POLICY_V1.netlist, 6, 1, "0x")).toBe("0x00");
    expect(evaluateNandNetlist(POLICY_V1.netlist, 6, 1, "0xdf1234")).toBe("0x01");
  });

  it.each([
    ["0x01", 6, 1],
    ["0x03000000000000", 6, 1],
    ["0x00000008000002", 6, 1],
    ["0x", 6, 1],
    ["0x00000002000003", 6, 0],
    ["0x00000002000003", 65_537, 1],
    ["0x00000002000003", 6, 2]
  ] as const)("rejects malformed or unsupported netlist %s (%i, %i)", (netlist, nIn, nOut) => {
    expect(() => decodeNandNetlist(netlist, nIn, nOut)).toThrow();
  });

  it("rejects invalid input masks and negative signal indices", () => {
    expect(() => flagsFromMask(64)).toThrow();
    expect(() => flagsFromMask(-1)).toThrow();
    expect(() => encodeNandNetlist([[-1, 0]], 0, 1)).toThrow();
  });
});
