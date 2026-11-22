import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", "pnpm", "build"], { cwd: root, stdio: "inherit" });
const code = await new Promise((resolve,reject) => { child.once("error", reject); child.once("exit", resolve); });
await writeFile(process.env.EMETER_BUILD_RESULT_PATH, JSON.stringify({ passed: code === 0, code }) + "\n");
if (code !== 0) process.exitCode = 1;
