import { readFile } from "node:fs/promises";
import { z } from "zod";

const RecordedProofSchema = z.object({
  kind: z.literal("mainnet-read-only-verification"),
  chainId: z.literal(196),
  independentRpcAgreement: z.literal(true),
  truthTableInputs: z.literal(64),
  creationInputsMatchCompiledArtifacts: z.literal(true),
  historicalDenialVerified: z.literal("PolicyDenied(15)"),
  balances: z.object({ refunded: z.literal(true) })
});

/** Historical demonstration proof only; this does not enable paid execution. */
export async function recordedMainnetProofVerified(): Promise<boolean> {
  try {
    const source = await readFile(new URL("../../../docs/evidence/mainnet-verification.json", import.meta.url), "utf8");
    return RecordedProofSchema.safeParse(JSON.parse(source)).success;
  } catch {
    return false;
  }
}
