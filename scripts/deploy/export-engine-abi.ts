import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const exports: string[] = ["// Generated from compiled Foundry artifacts; run pnpm contracts:bindings.\n"];
for (const [name, symbol] of [["EmeterRegistry", "emeterRegistryAbi"], ["EmeterVault", "emeterVaultAbi"]] as const) {
  const artifact = JSON.parse(await readFile(join(repoRoot, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: unknown[] };
  exports.push(`export const ${symbol} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`);
}
await mkdir(join(repoRoot, "packages/shared/src/generated"), { recursive: true });
await writeFile(join(repoRoot, "packages/shared/src/generated/engine-abi.ts"), exports.join("\n"));
console.log("Exported compiled registry and session-vault ABIs.");
