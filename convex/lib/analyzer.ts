"use node";

import { keccak256, toHex } from "viem";
import { usageAmount } from "@emeter/shared";
import { createAnalyzer } from "../../apps/gateway/src/ai";
import type { Analyzer } from "../../apps/gateway/src/ai";
import type { Address, Hex } from "viem";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { errorCode } from "./database";

export function usdNano(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error("INVALID_AI_COST");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 1_000_000_000n + BigInt((fraction + "000000000").slice(0,9))
    + (/[1-9]/.test(fraction.slice(9)) ? 1n : 0n)).toString();
}
export async function boundedAnalyzer(ctx: ActionCtx, container: Address, signMessage: (message: { message: { raw: Hex } }) => Promise<Hex>, clientId: string): Promise<Analyzer> {
  const analyzer = await createAnalyzer(container, signMessage);
  return { ...analyzer, analyze: async text => {
    if (!analyzer.price) throw new Error("AI_PRICE_NOT_VERIFIED");
    const inputMaximum = Buffer.byteLength(JSON.stringify(text), "utf8") + 4096;
    const maximum = usdNano(usageAmount({ prompt_tokens: inputMaximum, completion_tokens: 1024, total_tokens: inputMaximum + 1024 }, analyzer.price));
    const requestId = keccak256(toHex(clientId));
    try { await ctx.runMutation(internal.aiBudget.reserve, { requestId, maximumUsdNano: maximum }); }
    catch (error) { throw new Error(errorCode(error) ?? "AI_BUDGET_UNAVAILABLE"); }
    try {
      const result = await analyzer.analyze(text);
      const evidence = (result as any).usageEvidence?.receipt?.result;
      const cost = evidence?.prices?.find((item: any) => item.currency === "USD")?.amount;
      await ctx.runMutation(internal.aiBudget.finish, { requestId, ...(typeof cost === "string" ? { actualUsdNano: usdNano(cost) } : {}) });
      return result;
    } catch (error) {
      await ctx.runMutation(internal.aiBudget.finish, { requestId }).catch(() => undefined);
      throw error;
    }
  } };
}
