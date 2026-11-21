import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@emeter/shared", "@emeter/sdk", "@emeter/circuit"],
  webpack(current) {
    current.resolve.extensionAlias = { ...current.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return current;
  }
};
export default config;
