import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { repoRoot } from "../lib/config.js";

const target = process.argv[2] ?? "production";
if (!['production','development'].includes(target)) throw new Error("UNKNOWN_DEPLOYMENT_TARGET");
let path = join(homedir(), ".local/share/emeter/credentials/convex-runtime.env");
if (target === "development") {
  const hosted = JSON.parse(await readFile(join(repoRoot, "deployments/convex.json"), "utf8"));
  path = join(homedir(), ".local/share/emeter/credentials/convex-development.env");
  const values = { GATEWAY_ORIGIN: hosted.development.httpUrl, EMETER_PROVIDER_ORIGIN: hosted.development.httpUrl,
    EMETER_PROVIDER_ORIGINS: hosted.development.httpUrl, EMETER_NETWORK_MODE: "mainnet", EMETER_MAINNET_ENABLED: "false",
    EMETER_BROWSER_ORIGINS: "http://127.0.0.1:3100,http://localhost:3100" };
  await writeFile(path, Object.entries(values).map(([key,value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 });
}
const args = ["proxy", join(repoRoot, "node_modules/.bin/convex"), "env", "set", "--from-file", path, "--force",
  "--deployment", target === "production" ? "greyw0rks:emeter:production" : "greyw0rks:emeter:dev/validation"];
const mainnetEnabled = /^EMETER_MAINNET_ENABLED=(?:"true"|true)\r?$/m.test(await readFile(path, "utf8"));
const child = spawn("/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
// The CLI can echo values on errors. Its output is deliberately not forwarded.
child.stdout.resume(); child.stderr.resume();
const code = await new Promise<number | null>((resolve,reject) => { child.once("error", reject); child.once("exit", resolve); });
if (code !== 0) throw new Error("CONVEX_ENV_CONFIGURATION_FAILED");
console.log(JSON.stringify({ target, runtimeConfigured: true, operatorKeyUploaded: false, mainnetEnabled }));
