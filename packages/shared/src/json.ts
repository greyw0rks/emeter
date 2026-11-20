export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const forbidden = new Set(["__proto__", "constructor", "prototype"]);

function unicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Unpaired Unicode surrogate");
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error("Unpaired Unicode surrogate");
  }
}

/** RFC 8785 / TAP-11 §6. Object order is UTF-16; floats use ECMAScript's
 * shortest round-trip representation. Monetary fields must remain strings.
 */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new Error("JSON nesting limit");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)
      || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error("Noncanonical JSON number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") { unicode(value); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!(i in value)) throw new Error("Sparse JSON array");
    return "[" + value.map(item => canonicalJson(item, depth + 1)).join(",") + "]";
  }
  if (typeof value === "object" && value !== null
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return "{" + Object.keys(value).sort().map(key => {
      if (forbidden.has(key)) throw new Error("Forbidden JSON member");
      unicode(key);
      return JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key], depth + 1);
    }).join(",") + "}";
  }
  throw new Error("Unsupported JSON value");
}

/** Parses before losing duplicate members, including escaped duplicate names.
 * JSON.parse alone cannot establish the TAP-11/TAP-13 parsing requirements.
 */
export function parseStrictJson(text: string, maximumBytes = 1_048_576): JsonValue {
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error("JSON size limit");
  let at = 0;
  const space = () => { while (at < text.length && /[ \t\r\n]/.test(text[at]!)) at++; };
  const fail = (): never => { throw new Error("Invalid strict JSON"); };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++]!;
      if (c === "\\") { at++; continue; }
      if (c === '"') {
        const result: unknown = JSON.parse(text.slice(start, at));
        if (typeof result !== "string") return fail();
        unicode(result);
        return result;
      }
      if (c.charCodeAt(0) < 0x20) return fail();
    }
    return fail();
  };
  const value = (depth: number): JsonValue => {
    if (depth > 64) return fail();
    space();
    const c = text[at];
    if (c === '"') return string();
    if (c === "{") {
      at++; space();
      const out: Record<string, JsonValue> = Object.create(null);
      const seen = new Set<string>();
      if (text[at] === "}") { at++; return out; }
      while (at < text.length) {
        space();
        if (text[at] !== '"') return fail();
        const key = string();
        if (seen.has(key) || forbidden.has(key)) return fail();
        seen.add(key); space();
        if (text[at++] !== ":") return fail();
        out[key] = value(depth + 1); space();
        const next = text[at++];
        if (next === "}") return out;
        if (next !== ",") return fail();
      }
      return fail();
    }
    if (c === "[") {
      at++; space();
      const out: JsonValue[] = [];
      if (text[at] === "]") { at++; return out; }
      while (at < text.length) {
        out.push(value(depth + 1)); space();
        const next = text[at++];
        if (next === "]") return out;
        if (next !== ",") return fail();
      }
      return fail();
    }
    for (const [literal, result] of [["null", null], ["true", true], ["false", false]] as const) {
      if (text.startsWith(literal, at)) { at += literal.length; return result; }
    }
    const match = text.slice(at).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) return fail();
    at += match[0].length;
    const number = Number(match[0]);
    canonicalJson(number);
    return number;
  };
  const result = value(0); space();
  if (at !== text.length) return fail();
  return result;
}

export async function readJsonBody(response: Response, maximumBytes = 1_048_576) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximumBytes) throw new Error("Response size limit");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
