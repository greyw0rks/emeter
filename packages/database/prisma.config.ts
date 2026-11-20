import { defineConfig } from "prisma/config";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.EMETER_RUNTIME_ENV) {
  const path = realpathSync(process.env.EMETER_RUNTIME_ENV);
  if (path.startsWith(fileURLToPath(new URL("../../", import.meta.url))))
    throw new Error("Runtime credentials must remain outside the repository");
  process.loadEnvFile(path);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://emeter@127.0.0.1:55432/emeter" }
});
