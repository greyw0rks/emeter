import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import { usdNano } from "../../convex/lib/analyzer";

const modules = import.meta.glob("../../convex/**/*.{ts,js}");
afterEach(() => vi.unstubAllEnvs());
it("atomically limits concurrent upstream reservations", async () => {
  vi.stubEnv("EMETER_AI_USD_BUDGET_NANO", "10000000");
  const t = convexTest(schema, modules);
  const result = await Promise.allSettled(["one", "two"].map(requestId => t.mutation(internal.aiBudget.reserve, { requestId, maximumUsdNano: "7000000" })));
  expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect((await t.query(internal.aiBudget.status, {})).accountedUsdNano).toBe("7000000");
});
it("keeps unknown costs reserved and prevents replaying an upstream id", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.aiBudget.reserve, { requestId: "unknown", maximumUsdNano: "6000000" });
  await t.mutation(internal.aiBudget.finish, { requestId: "unknown" });
  await expect(t.mutation(internal.aiBudget.reserve, { requestId: "unknown", maximumUsdNano: "1" })).rejects.toMatchObject({ data: { code: "AI_REQUEST_ALREADY_STARTED" } });
  await expect(t.mutation(internal.aiBudget.reserve, { requestId: "next", maximumUsdNano: "5000000" })).rejects.toMatchObject({ data: { code: "AI_BUDGET_EXHAUSTED" } });
});
it("reconciles reported cost without losing precision", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.aiBudget.reserve, { requestId: "completed", maximumUsdNano: "6000000" });
  await t.mutation(internal.aiBudget.finish, { requestId: "completed", actualUsdNano: usdNano("0.00001950") });
  expect((await t.query(internal.aiBudget.status, {})).accountedUsdNano).toBe("19500");
  expect(usdNano("0.0000000001")).toBe("1");
});
