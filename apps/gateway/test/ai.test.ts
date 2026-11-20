import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAnalyzer, aiFailureCode } from "../src/ai.js";
import { verifyAiEvidence } from "@emeter/shared";
import type { JsonValue } from "@emeter/shared";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const signer = privateKeyToAccount(generatePrivateKey());
const container = "0x0000000000000000000000000000000000000001" as const;

function apiFixture(output: string, stop = "end_turn", status = 200) {
  vi.stubEnv("EMETER_AI_PROVIDER", "otari");
  vi.stubEnv("EMETER_AI_MODEL", "fixture-model");
  vi.stubEnv("EMETER_OTARI_ENV_FILE", undefined);
  vi.stubEnv("OTARI_API_KEY", "fixture-api-key");
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname.endsWith("/models")) return new Response(JSON.stringify({
      data: [{ id: "fixture-model", type: "model", display_name: "Fixture", created_at: "2026-01-01T00:00:00Z",
        pricing: { input_price_per_million: 0.1, output_price_per_million: 0.2 } }],
      has_more: false, first_id: "fixture-model", last_id: "fixture-model"
    }), { headers: { "content-type": "application/json" } });
    requests.push(await request.clone().text());
    if (status !== 200) return new Response(JSON.stringify({ type: "error",
      error: { type: "permission_error", message: "Fixture upstream refusal" } }), { status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model",
      content: [{ type: "text", text: output }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 }
    }), { headers: { "content-type": "application/json" } });
  }));
  return requests;
}

it.each(["json", "fenced"])("captures actual SDK body bytes and verifies %s AI output", async format => {
  const analysis = { summary: "A fixture paragraph.", sentiment: "neutral", topics: ["testing"] };
  const text = JSON.stringify(analysis);
  const requests = apiFixture(format === "fenced" ? "\u0060\u0060\u0060json\n" + text + "\n\u0060\u0060\u0060" : text);
  const analyzer = await createAnalyzer(container, signer.signMessage);
  const result = await analyzer.analyze("A paragraph.") as Record<string, JsonValue>;
  expect(requests).toHaveLength(1);
  const evidence = result.usageEvidence as Record<string, JsonValue>;
  expect(Buffer.from(evidence.requestBodyBase64 as string, "base64").toString()).toBe(requests[0]);
  expect(result.analysis).toEqual(analysis);
  expect((await verifyAiEvidence(evidence, { container, signer: signer.address, text: "A paragraph.", analysis })).priceVerified).toBe(true);
});

it("refuses a response the upstream reports as truncated", async () => {
  apiFixture('{"summary":"x","sentiment":"neutral","topics":[]}', "max_tokens");
  const analyzer = await createAnalyzer(container, signer.signMessage);
  await expect(analyzer.analyze("A paragraph.")).rejects.toThrow("INCOMPLETE_AI_RESPONSE");
});

it("reports an upstream permission error without exposing its body or credentials", async () => {
  apiFixture("", "end_turn", 403);
  const analyzer = await createAnalyzer(container, signer.signMessage);
  let failure: unknown;
  try { await analyzer.analyze("A paragraph."); } catch (error) { failure = error; }
  expect(aiFailureCode(failure)).toBe("AI_UPSTREAM_HTTP_403");
});

it("refuses multiple JSON objects and unexpected analysis fields", async () => {
  apiFixture('{"summary":"x","sentiment":"neutral","topics":[]} {"extra":true}');
  const analyzer = await createAnalyzer(container, signer.signMessage);
  await expect(analyzer.analyze("A paragraph.")).rejects.toThrow("AI_OUTPUT_INVALID");
});
