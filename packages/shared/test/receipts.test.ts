import { readFileSync } from "node:fs";
import { hashMessage, keccak256, toHex } from "viem";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { BaseUnitsSchema, normalizeTap13Signature, tap13DigestFromHashes, verifyTap13Hashes } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/tap-13-envelopes.json", import.meta.url), "utf8")) as {
  container: Address;
  signerAddress: Address;
  cases: { name: string; id: string; canonicalRequest: string; canonicalBody: string; ok: boolean; ts: number; digest: Hex; eip191Digest: Hex; sig: Hex }[];
  signatureEncoding: { cases: { name: string; sig: Hex; expect: string }[] };
};

function evidence(row: (typeof vectors.cases)[number]) {
  return {
    container: vectors.container,
    idHash: keccak256(toHex(row.id)),
    requestHash: keccak256(toHex(row.canonicalRequest)),
    ok: row.ok,
    bodyHash: keccak256(toHex(row.canonicalBody)),
    ts: BigInt(row.ts)
  };
}

describe("TAP-13 hash and signature interoperability", () => {
  for (const row of vectors.cases) {
    it(`matches official digest and signature: ${row.name}`, async () => {
      const digest = tap13DigestFromHashes(evidence(row));
      expect(digest).toBe(row.digest);
      expect(hashMessage({ raw: digest })).toBe(row.eip191Digest);
      expect(await verifyTap13Hashes(evidence(row), row.sig, vectors.signerAddress)).toBe(true);
    });
  }

  for (const row of vectors.signatureEncoding.cases) {
    it(`applies official encoding rule: ${row.name}`, async () => {
      const expected = row.expect === "accepted";
      if (expected) expect(normalizeTap13Signature(row.sig)).toBe(vectors.cases[0]!.sig);
      else expect(() => normalizeTap13Signature(row.sig)).toThrow();
      expect(await verifyTap13Hashes(evidence(vectors.cases[0]!), row.sig, vectors.signerAddress)).toBe(expected);
    });
  }

  it("rejects a changed body, request, success flag, timestamp, or container", async () => {
    const row = vectors.cases[0]!;
    const original = evidence(row);
    const changes = [
      { bodyHash: keccak256(toHex("different body")) },
      { requestHash: keccak256(toHex("different request")) },
      { idHash: keccak256(toHex("different id")) },
      { ok: !original.ok },
      { ts: original.ts + 1n },
      { container: "0x0000000000000000000000000000000000000001" as Address }
    ];
    for (const change of changes) {
      expect(await verifyTap13Hashes({ ...original, ...change }, row.sig, vectors.signerAddress)).toBe(false);
    }
  });

  it("requires safe timestamps and full-width hashes", () => {
    const input = evidence(vectors.cases[0]!);
    expect(() => tap13DigestFromHashes({ ...input, ts: 9_007_199_254_740_992n })).toThrow();
    expect(() => tap13DigestFromHashes({ ...input, bodyHash: "0x00" })).toThrow();
  });
});

it("uses unsigned integer base units rather than floating point amounts", () => {
  expect(BaseUnitsSchema.parse("50000")).toBe("50000");
  for (const value of ["0.05", "1e6", "-1", "01"]) expect(() => BaseUnitsSchema.parse(value)).toThrow();
});
