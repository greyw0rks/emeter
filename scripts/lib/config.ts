import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineChain, getAddress } from "viem";
import type { Address } from "viem";
import { X_LAYER } from "@emeter/shared";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
for (const file of [".env.local", ".env"]) {
  const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export const xLayerChain = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: X_LAYER.nativeCurrency,
  rpcUrls: { default: { http: [X_LAYER.rpcUrl] } },
  blockExplorers: { default: { name: "OKLink", url: X_LAYER.explorerUrl } }
});

export const DEFAULT_PROOF_PROCESSOR = "0x67be9042961344ccd387b04C24747B0c6C6D2212" as Address;
export const DEFAULT_DEPLOYER = "0xE79bB36b53835f0740BD4a9684F5C84d8fB9b52C" as Address;
export const DEFAULT_PROVIDER = "0xBA46d08B9E298E8E70096Fc238Da207139BCCAB7" as Address;
export const FACTORY_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const PROCESSOR_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
export const DOCUMENTED_FACTORY_IMPLEMENTATION = "0x74956236Ab64eD143933040B4137E8A352e4d17b";
export const EXPECTED_CIRCUIT_IMPLEMENTATION = "0x977f217887E085D298Cb3819cDAD5A0ee35F29B2";

export function config() {
  const factory = getAddress(process.env.TAPEOUT_FACTORY_ADDRESS || X_LAYER.factory);
  const beacon = getAddress(process.env.TAPEOUT_BEACON_ADDRESS || X_LAYER.beacon);
  // These deployments are pinned to the reviewed TapeOut/X Layer configuration.
  if (factory.toLowerCase() !== X_LAYER.factory.toLowerCase() || beacon.toLowerCase() !== X_LAYER.beacon.toLowerCase()) {
    throw new Error("Unexpected TapeOut factory or beacon; review a new deployment explicitly");
  }
  return {
    rpc: process.env.X_LAYER_RPC_URL || X_LAYER.rpcUrl,
    secondaryRpc: process.env.X_LAYER_SECONDARY_RPC_URL || "https://xlayer.drpc.org",
    factory, beacon,
    processor: getAddress(process.env.TAPEOUT_PROCESSOR_ADDRESS || DEFAULT_PROOF_PROCESSOR),
    deployer: getAddress(process.env.EMETER_DEPLOYER_ADDRESS || DEFAULT_DEPLOYER),
    provider: getAddress(process.env.EMETER_PROVIDER_SIGNER_ADDRESS || DEFAULT_PROVIDER),
    nativeSpendCap: BigInt(process.env.EMETER_MAX_NATIVE_SPEND_WEI || "10000000000000000")
  };
}
