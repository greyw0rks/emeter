import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeNandNetlist, evaluateNandNetlist } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/tap-02-vectors.json", import.meta.url), "utf8")) as {
  valid: { name: string; nIn: number; nOut: number; nState: number; netlist: Hex; truthTable?: { inputs: string; outputs: string }[] }[];
  illFormed: { name: string; nIn: number; nOut: number; netlist: Hex }[];
  packingEdgeCases: { circuit: string; cases: { case: string; inputs: string; outputs: string }[] };
};

describe("official TAP-02 stateless NAND vectors", () => {
  for (const circuit of vectors.valid.filter(v => v.nState === 0 && v.truthTable)) {
    it(`matches the complete published ${circuit.name} truth table`, () => {
      for (const row of circuit.truthTable!) {
        expect(evaluateNandNetlist(circuit.netlist, circuit.nIn, circuit.nOut, `0x${row.inputs}`)).toBe(`0x${row.outputs}`);
      }
    });
  }
  for (const circuit of vectors.illFormed) {
    it(`rejects published invalid circuit ${circuit.name}`, () => {
      expect(() => decodeNandNetlist(circuit.netlist, circuit.nIn, circuit.nOut)).toThrow();
    });
  }
  const nand = vectors.valid.find(v => v.name === vectors.packingEdgeCases.circuit)!;
  for (const row of vectors.packingEdgeCases.cases) {
    it(`matches deployed input packing: ${row.case}`, () => {
      expect(evaluateNandNetlist(nand.netlist, nand.nIn, nand.nOut, `0x${row.inputs}`)).toBe(`0x${row.outputs}`);
    });
  }
});
