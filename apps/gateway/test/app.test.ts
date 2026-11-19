import { expect, it } from "vitest";
import { buildGateway } from "../src/app.js";

it("reports protocol phase without claiming paid execution", async () => {
  const app = buildGateway();
  const response = await app.inject({ method: "GET", url: "/api/protocol" });
  expect(response.json()).toMatchObject({ chainId: 196, paidExecutionReady: false, mainnetProofVerified: false });
  await app.close();
});

it("refuses execution while the billing product is unimplemented", async () => {
  const app = buildGateway();
  const response = await app.inject({ method: "POST", url: "/api/execute/text-analyzer", payload: { text: "example" } });
  expect(response.statusCode).toBe(503);
  expect(response.json().error).toBe("PAID_EXECUTION_NOT_READY");
  await app.close();
});
