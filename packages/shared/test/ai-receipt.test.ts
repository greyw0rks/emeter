import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anthropicUsage, canonicalJson, jsonSafe, signTap13, usageAmount, verifyAiEvidence } from "../src/index.js";
import type { AiPrice, JsonValue } from "../src/index.js";

const signer = privateKeyToAccount(generatePrivateKey());
const container = "0x0000000000000000000000000000000000000001" as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

it("matches the independent TAP-17 weighted pricing example", () => {
  expect(usageAmount({ prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500,
    cache_read_tokens: 1000, reasoning_tokens: 100 }, {
    currency: "USD", unit: "1M tokens", input: "1.25", cacheRead: "0.125", output: "10", reasoning: "12"
  })).toBe("0.00357500");
});

it("rounds up once after summing weighted counts", () => {
  expect(usageAmount({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, {
    currency: "USD", unit: "1M tokens", input: "0.00000001", output: "0.00000001"
  })).toBe("0.00000001");
});

it("keeps arithmetic exact for maximum safe counts and large prices", () => {
  expect(usageAmount({ prompt_tokens: 9_007_199_254_740_991, completion_tokens: 0, total_tokens: 9_007_199_254_740_991 }, {
    currency: "USD", unit: "1M tokens", input: "100000000000000000", output: "0"
  })).toBe("900719925474099100000000000.00000000");
});

it("does not price per-use counts as tokens", () => {
  expect(usageAmount({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, other: { web_search_requests: 5 } }, {
    currency: "USD", unit: "1M tokens", input: "5", output: "25"
  })).toBe("0.00000000");
});

it("normalizes Anthropic cache writes, reads, and per-use counts", () => {
  expect(anthropicUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20,
    cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 10 },
    server_tool_use: { web_search_requests: 2 } } }, 200)).toEqual({
    prompt_tokens: 60, completion_tokens: 5, total_tokens: 65, cache_read_tokens: 20, cache_write_tokens: 30,
    cache_write_1h_tokens: 10, other: { web_search_requests: 2 }
  });
});

it("reads malformed cache fields as absent, preserves zero, and fails inconsistent counts", () => {
  expect(anthropicUsage({ usage: { input_tokens: 10, cache_read_input_tokens: "20", cache_creation_input_tokens: 0 } }, 200))
    .toEqual({ prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cache_write_tokens: 0 });
  expect(anthropicUsage({ usage: { input_tokens: 10, cache_creation_input_tokens: 1,
    cache_creation: { ephemeral_1h_input_tokens: 2 } } }, 200)).toBeNull();
  expect(anthropicUsage({ usage: { input_tokens: 10, output_tokens: "5" } }, 200)).toBeNull();
  expect(anthropicUsage({ usage: { input_tokens: 10, output_tokens: 5 } }, 500)).toBeNull();
});

async function evidence() {
  const analysis = { summary: "A test paragraph.", sentiment: "neutral", topics: ["testing"] };
  const request = JSON.stringify({ model: "fixture-model", max_tokens: 1024, messages: [{ role: "user", content: "A paragraph." }] });
  const response = JSON.stringify({ id: "fixture-response", model: "fixture-model", type: "message", stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(analysis) }], usage: { input_tokens: 10, output_tokens: 5 } });
  const price: AiPrice = { currency: "USD", unit: "1M tokens", input: "0.1", output: "0.2" };
  const params = { path: "/v1/messages", requestSha256: hash(request) };
  const result = { model: "fixture-model", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    responseSha256: hash(response), stream: false, complete: true, status: 200,
    prices: [{ currency: "USD", amount: "0.00000200" }], modelMatchedBy: "response" };
  const signed = await signTap13({ id: "fixture-response", method: "anthropic_messages", params }, container, jsonSafe(result), true,
    1_795_000_000, signer.signMessage);
  return { analysis, value: { receipt: { id: signed.id, ok: true, container, ts: signed.ts,
    method: "anthropic_messages", params, result, sig: signed.sig }, requestBodyBase64: Buffer.from(request).toString("base64"),
    responseBodyBase64: Buffer.from(response).toString("base64"), status: 200, format: "anthropic-messages", priceTable: [price], priceModel: "fixture-model" } };
}

it("verifies signature, raw body hashes, model matching, usage, cost, input, and returned output", async () => {
  const data = await evidence();
  expect((await verifyAiEvidence(data.value, { container, signer: signer.address, text: "A paragraph.", analysis: data.analysis })).priceVerified).toBe(true);
});

it.each(["request", "response", "input", "output", "signer"] as const)("rejects changed AI %s evidence", async field => {
  const data = await evidence();
  if (field === "request") data.value.requestBodyBase64 = Buffer.from("{}").toString("base64");
  if (field === "response") data.value.responseBodyBase64 = Buffer.from("{}").toString("base64");
  await expect(verifyAiEvidence(data.value, { container,
    signer: field === "signer" ? privateKeyToAccount(generatePrivateKey()).address : signer.address,
    text: field === "input" ? "Another paragraph." : "A paragraph.",
    analysis: field === "output" ? { ...data.analysis, sentiment: "positive" } : data.analysis })).rejects.toThrow();
});

it("rejects a validly signed receipt whose usage or price disagrees with retained bytes", async () => {
  for (const field of ["usage", "price"] as const) {
    const data = await evidence();
    if (field === "usage") data.value.receipt.result.usage.prompt_tokens = 999;
    else data.value.receipt.result.prices[0]!.amount = "0.00000001";
    const signed = await signTap13({ id: data.value.receipt.id, method: "anthropic_messages", params: data.value.receipt.params },
      container, data.value.receipt.result as JsonValue, true, data.value.receipt.ts, signer.signMessage);
    data.value.receipt.sig = signed.sig;
    await expect(verifyAiEvidence(data.value, { container, signer: signer.address })).rejects.toThrow();
  }
});

it("rejects duplicate JSON members even if the receipt signature covers their raw hash", async () => {
  const data = await evidence();
  const response = '{"model":"fixture-model","usage":{"input_tokens":10,"input_tokens":100}}';
  data.value.responseBodyBase64 = Buffer.from(response).toString("base64");
  data.value.receipt.result.responseSha256 = hash(response);
  await expect(verifyAiEvidence(data.value, { container, signer: signer.address })).rejects.toThrow();
});
