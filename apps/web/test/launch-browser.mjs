import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const job = process.argv[2] ?? "browser";
if (!["browser", "public", "checks", "build"].includes(job)) throw new Error("Unknown verification job");
const web = fileURLToPath(new URL("../", import.meta.url));
const directory = "/tmp/emeter-" + job + "-" + randomUUID();
mkdirSync(directory, { mode: 0o700 });
const log = join(directory, "run.log"), result = join(directory, "result.json");
const output = openSync(log, "w", 0o600);
const args = job === "browser" || job === "public" ? [require.resolve("tsx/cli"), job === "public" ? "test/public-browser.mjs" : "test/browser.ts"] : [job === "build" ? "test/build.mjs" : "test/checks.mjs"];
const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", process.execPath, ...args],
  { cwd: web, detached: true, stdio: ["ignore", output, output], env: { ...process.env, [job === "browser" || job === "public" ? "EMETER_BROWSER_RESULT_PATH" : job === "build" ? "EMETER_BUILD_RESULT_PATH" : "EMETER_CHECK_RESULT_PATH"]: result } });
child.unref(); closeSync(output);
process.stdout.write(JSON.stringify({ pid: child.pid, log, result }) + "\n");
