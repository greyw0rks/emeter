import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../lib/config.js";
import { verifyXLayer } from "../lib/verification.js";

try {
  const report = await verifyXLayer();
  await mkdir(join(repoRoot, "docs/evidence"), { recursive: true });
  await writeFile(join(repoRoot, "docs/evidence/xlayer-preflight.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "X Layer verification failed");
  process.exitCode = 1;
}
