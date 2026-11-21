import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const jobs = [];
try {
  for (const name of ["typecheck", "test"]) {
    const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", "pnpm", name], { cwd: root, stdio: "inherit" });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    jobs.push({ name, code }); if (code !== 0) throw new Error(name + " failed");
  }
  await writeFile(process.env.EMETER_CHECK_RESULT_PATH, JSON.stringify({ passed: true, jobs }) + "\n");
} catch (failure) {
  await writeFile(process.env.EMETER_CHECK_RESULT_PATH, JSON.stringify({ passed: false, jobs, error: failure.message }) + "\n");
  process.exitCode = 1;
}
