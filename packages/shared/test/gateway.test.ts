import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson, ClientIdSchema, parseStrictJson, readJsonBody, signTap13, verifyTap13Response } from "../src/index.js";
import type { ServiceCall } from "../src/index.js";

const signer = privateKeyToAccount(generatePrivateKey());
const container = "0x0000000000000000000000000000000000000001" as const;
const call: ServiceCall = { id: "request-α", method: "json_validate", params: { input: { value: 7 } } };
const now = 1_795_000_000;

it("canonicalizes nested objects, Unicode, and floats by TAP-11 value rules", () => {
  expect(canonicalJson(parseStrictJson('{"z":1e-7,"a":{"β":2,"a":1},"list":[true,null]}')))
    .toBe('{"a":{"a":1,"β":2},"list":[true,null],"z":1e-7}');
});

it.each([
  '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}',
  '[1,]', '{"a":-0}', '9007199254740992', '1e999', '"\\ud800"', '\ufeff{"a":1}'
])("rejects ambiguous or unsafe JSON: %s", value => {
  expect(() => parseStrictJson(value)).toThrow();
});

it("uses UTF-16 code units for request ids and rejects malformed Unicode", () => {
  expect(ClientIdSchema.safeParse("😀".repeat(64)).success).toBe(true);
  expect(ClientIdSchema.safeParse("😀".repeat(65)).success).toBe(false);
  expect(ClientIdSchema.safeParse("\ud800").success).toBe(false);
});

it("enforces nesting, body-size, and canonical value limits", async () => {
  expect(() => canonicalJson({ money: BigInt(1) })).toThrow();
  expect(() => parseStrictJson("[".repeat(66) + "0" + "]".repeat(66))).toThrow();
  expect(() => parseStrictJson('"123456"', 4)).toThrow();
  await expect(readJsonBody(new Response("x".repeat(1_048_577)))).rejects.toThrow("size limit");
});

it("accepts a signed null result and ignores non-429 HTTP status", async () => {
  const envelope = await signTap13(call, container, null, true, now, signer.signMessage);
  const verified = await verifyTap13Response({ call, container, signer: signer.address, httpStatus: 500,
    body: canonicalJson(envelope), now });
  expect(verified.outcome).toBe("accepted_result");
  expect(verified.receipt?.bodyHash).toMatch(/^0x[0-9a-f]{64}$/);
});

it("attributes signed errors to the original request", async () => {
  const envelope = await signTap13(call, container, { code: "INTERNAL", message: "Unable to execute." }, false, now, signer.signMessage);
  expect((await verifyTap13Response({ call, container, signer: signer.address, httpStatus: 500,
    body: canonicalJson(envelope), now })).outcome).toBe("accepted_error");
});

it("recognizes the special malformed-request binding before normal verification", async () => {
  const envelope = await signTap13({ id: "", method: call.method, params: {} }, container,
    { code: "BAD_REQUEST", message: "Invalid id." }, false, now, signer.signMessage);
  expect((await verifyTap13Response({ call, container, signer: signer.address, httpStatus: 400,
    body: canonicalJson(envelope), now })).outcome).toBe("own_request_malformed");
});

it("treats HTTP 429 as rate limiting even when the body is invalid or signed", async () => {
  expect((await verifyTap13Response({ call, container, signer: signer.address,
    httpStatus: 429, body: "not JSON", now })).outcome).toBe("rate_limited");
});

it.each(["id", "container", "body", "request", "time", "signer"] as const)("rejects a changed %s binding", async field => {
  const envelope = await signTap13(call, container, { valid: true }, true, now, signer.signMessage);
  const modified: Record<string, unknown> = { ...envelope };
  if (field === "id") modified.id = "another-id";
  if (field === "container") modified.container = "0x0000000000000000000000000000000000000002";
  if (field === "body") modified.result = { valid: false };
  expect((await verifyTap13Response({ call: field === "request" ? { ...call, params: { input: { value: 8 } } } : call,
    container, signer: field === "signer" ? privateKeyToAccount(generatePrivateKey()).address : signer.address,
    httpStatus: 200, body: canonicalJson(modified), now: field === "time" ? now + 301 : now })).outcome).toBe("binding_failure");
});

it("rejects duplicate members before interpreting a signed envelope", async () => {
  const envelope = await signTap13(call, container, { valid: true }, true, now, signer.signMessage);
  const text = canonicalJson(envelope).replace('"ok":true', '"ok":false,"ok":true');
  expect((await verifyTap13Response({ call, container, signer: signer.address, httpStatus: 200, body: text, now })).outcome)
    .toBe("transport_failure");
});
