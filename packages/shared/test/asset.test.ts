import { describe, expect, it, vi } from "vitest";

vi.mock("../../../deployments/xlayer-196-usdc.json", async importOriginal => {
  const { default: record } = await importOriginal<typeof import("../../../deployments/xlayer-196-usdc.json")>();
  return { default: { ...record, completed: false, contracts: { ...record.contracts, vault: null } } };
});
import { configuredPaymentDeployment, HISTORICAL_DEMO, LEGACY_DEPLOYMENT, paymentAsset, X_LAYER_USDC } from "../src/index.js";

describe("USDC payment deployment", () => {
  it("pins the officially documented token and rejects the older USDC.e", () => {
    expect(paymentAsset(X_LAYER_USDC.address)).toMatchObject({ symbol: "USDC", decimals: 6 });
    expect(() => paymentAsset("0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035")).toThrow("UNSUPPORTED_PAYMENT_TOKEN");
  });
  it("requires a new vault and never substitutes USDC into the DEMO vault", () => {
    expect(() => configuredPaymentDeployment({})).toThrow("USDC_DEPLOYMENT_PENDING");
    expect(() => configuredPaymentDeployment({ EMETER_VAULT_ADDRESS: LEGACY_DEPLOYMENT.vault })).toThrow("USDC_VAULT_REQUIRED");
    expect(() => configuredPaymentDeployment({ EMETER_VAULT_ADDRESS: "0x0000000000000000000000000000000000000000" })).toThrow("USDC_VAULT_REQUIRED");
    expect(configuredPaymentDeployment({ EMETER_VAULT_ADDRESS: "0x0000000000000000000000000000000000000001" }).token).toBe(X_LAYER_USDC.address);
  });
  it("keeps explicit historical fixture mode local", () => {
    expect(() => configuredPaymentDeployment({ EMETER_PAYMENT_ASSET: "DEMO", EMETER_NETWORK_MODE: "mainnet" })).toThrow("DEMO_REQUIRES_LOCAL_FORK");
    expect(configuredPaymentDeployment({ EMETER_PAYMENT_ASSET: "DEMO", EMETER_NETWORK_MODE: "local-fork" }).token).toBe(HISTORICAL_DEMO.address);
  });
});
