import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { repoRoot } from "./config.js";

/** Reads only the explicitly configured external signer file. No key is written,
 * returned in a report, put in a command argument, or sent to an RPC endpoint.
 */
export async function loadExternalSigner(expectedAddress: Address) {
  const path = process.env.EMETER_SIGNER_FILE;
  if (!path) throw new Error("Set EMETER_SIGNER_FILE to an authorized key file outside this repository");
  const real = await realpath(path);
  const root = resolve(repoRoot);
  if (real === root || real.startsWith(root + sep)) throw new Error("Signer files must remain outside the repository");
  const source = await readFile(real, "utf8");
  const candidates = new Set(source.match(/\b0x[0-9a-fA-F]{64}\b/g) ?? []);
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/(?:private[_ -]?key|wallet[_ -]?key|deployer[_ -]?key)\s*[:=]\s*['"]?([0-9a-fA-F]{64})['"]?\s*$/i);
    if (match) candidates.add("0x" + match[1]);
  }
  for (const candidate of candidates) {
    try {
      const account = privateKeyToAccount(candidate as Hex);
      if (account.address.toLowerCase() === expectedAddress.toLowerCase()) return account;
    } catch { /* Credential input must never appear in an error message. */ }
  }
  throw new Error("The configured external signer file has no key for the expected public address");
}
