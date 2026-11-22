import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = "/tmp/emeter-activation-" + randomUUID();
mkdirSync(directory, { mode: 0o700 });
const log = join(directory, "run.log"), result = join(directory, "result.json");
const output = openSync(log, "w", 0o600);
const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", ["proxy", process.execPath, require.resolve("tsx/cli"), "scripts/deploy/activate-gateway.ts", "--broadcast"],
  { cwd: root, detached: true, stdio: ["ignore", output, output], env: { ...process.env, EMETER_ACTIVATION_RESULT_PATH: result } });
child.unref(); closeSync(output);
process.stdout.write(JSON.stringify({ pid: child.pid, log, result }) + "\n");
