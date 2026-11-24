import { getAddress } from "viem";
import type { Address } from "viem";

/** X Layer's recommended USDC follows Circle's Bridged USDC Standard.
 * It is distinct from the older USDC.e at 0xA8CE…C035.
 * https://github.com/okx/xlayer-docs/blob/main/developer/bridge/usdc-on-x-layer.mdx
 */
export const X_LAYER_USDC = {
  address: "0x74b7F16337b8972027F6196A17a631aC6dE26d22" as Address,
  symbol: "USDC", decimals: 6,
  documentationUrl: "https://www.okx.com/xlayer/docs/developer/bridge/usdc-on-x-layer",
  exchangeUrl: "https://www.okx.com/balance/withdrawal",
} as const;
export const HISTORICAL_DEMO = {
  address: "0x66D16469E07217E53618887B492b14eA732b5a11" as Address,
  symbol: "DEMO", decimals: 6,
} as const;
export function paymentAsset(address: string) {
  const checked = getAddress(address);
  if (checked === getAddress(X_LAYER_USDC.address)) return X_LAYER_USDC;
  if (checked === getAddress(HISTORICAL_DEMO.address)) return HISTORICAL_DEMO;
  throw new Error("UNSUPPORTED_PAYMENT_TOKEN");
}
