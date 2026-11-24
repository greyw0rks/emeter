import { getAddress } from "viem";
import type { Address } from "viem";
import deployment from "../../../deployments/xlayer-196-usdc.json";
import { HISTORICAL_DEMO, X_LAYER_USDC } from "./asset.js";

export const LEGACY_DEPLOYMENT = {
  chainId: 196,
  vault: "0x12412460847a865b29406fd8cd37df91dd881b50" as Address,
  registry: "0xec4839b1bdfac9450feeb211cf59a7cf075110f3" as Address,
  token: HISTORICAL_DEMO.address,
  adapter: "0x87DB7961f425dDb39c54a8582D21f91a57C637B5" as Address,
  proofTransaction: "0x96fa8e32843b764fd069852346394b053be601adcf9c646d67eef674cf9c159c",
} as const;
export type PaymentDeployment = { chainId: 196; vault: Address; registry: Address; token: Address; adapter: Address };

export function paymentDeploymentBlock(env: Record<string, string | undefined>, historicalBlock: string): bigint {
  const value = env.EMETER_INDEXER_START_BLOCK?.trim() || (env.EMETER_PAYMENT_ASSET === "DEMO" ? historicalBlock : deployment.deploymentBlock);
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error("PAYMENT_INDEXER_START_BLOCK_REQUIRED");
  return BigInt(value);
}

/** Explicit DEMO mode is only for disposable historical fork verification.
 * Never pair USDC with the immutable DEMO vault or silently fall back to DEMO.
 */
export function configuredPaymentDeployment(env: Record<string, string | undefined>): PaymentDeployment {
  if (env.EMETER_PAYMENT_ASSET === "DEMO") {
    if (env.EMETER_NETWORK_MODE !== "local-fork") throw new Error("DEMO_REQUIRES_LOCAL_FORK");
    return LEGACY_DEPLOYMENT;
  }
  if (env.EMETER_PAYMENT_ASSET && env.EMETER_PAYMENT_ASSET !== "USDC") throw new Error("UNSUPPORTED_PAYMENT_TOKEN");
  const vault = env.EMETER_VAULT_ADDRESS ?? (deployment.completed ? deployment.contracts.vault : null);
  if (!vault) throw new Error("USDC_DEPLOYMENT_PENDING");
  const address = getAddress(vault);
  if (address === getAddress(LEGACY_DEPLOYMENT.vault) || /^0x0{40}$/i.test(address)) throw new Error("USDC_VAULT_REQUIRED");
  return { chainId: 196, vault: address, token: X_LAYER_USDC.address,
    registry: getAddress(deployment.contracts.registry), adapter: getAddress(deployment.contracts.adapter) };
}
