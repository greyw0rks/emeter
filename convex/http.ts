import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { readJsonBody } from "../packages/shared/src/json";

function newToken(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,"0")).join("");
}
const handler = httpAction(async (ctx, request) => {
  const url = new URL(request.url), origin = request.headers.get("origin");
  const allowed = (process.env.EMETER_BROWSER_ORIGINS ?? "http://127.0.0.1:3100,http://localhost:3100").split(",").map(value => value.trim());
  const headers: Record<string,string> = { "content-type": "application/json", "cache-control": "no-store", vary: "Origin" };
  if (origin && origin !== url.origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers });
  if (origin) headers["access-control-allow-origin"] = origin;
  if (request.method === "OPTIONS") {
    Object.assign(headers, { "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "600" });
    return new Response(null, { status: 204, headers });
  }
  let body: string | undefined;
  try { if (request.method === "POST") body = await readJsonBody(new Response(request.body), 131_072); }
  catch { return new Response(JSON.stringify({ error: "REQUEST_TOO_LARGE_OR_INVALID_ENCODING" }), { status: 413, headers }); }
  const authorization = request.headers.get("authorization"), bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,128})$/)?.[1];
  const credentialHash = bearer ? await digest(bearer) : undefined;
  const issue = request.method === "POST" && ["/api/auth/verify", "/api/keys"].includes(url.pathname);
  const token = issue ? newToken(url.pathname === "/api/keys" ? "emeter_" : "") : undefined;
  try {
    const response = await ctx.runAction(internal.runtime.handle, {
      method: request.method, path: url.pathname + url.search, ...(body === undefined ? {} : { body }),
      ...(origin ? { origin } : {}), ...(credentialHash ? { credentialHash } : {}),
      ...(token ? { issuedCredentialHash: await digest(token) } : {}),
      ...(request.headers.has("x-emeter-timestamp") ? { dispatchTimestamp: request.headers.get("x-emeter-timestamp")! } : {}),
      ...(request.headers.has("x-emeter-dispatch") ? { dispatchSignature: request.headers.get("x-emeter-dispatch")! } : {})
    });
    let result = response.body;
    if (token && response.status >= 200 && response.status < 300) {
      const parsed = JSON.parse(result);
      if (url.pathname === "/api/keys" && "key" in parsed) parsed.key = token;
      if (url.pathname === "/api/auth/verify" && "token" in parsed) parsed.token = token;
      result = JSON.stringify(parsed);
    }
    return new Response(result, { status: response.status, headers: { ...response.headers, ...headers } });
  } catch { return new Response(JSON.stringify({ error: "GATEWAY_OPERATION_UNAVAILABLE" }), { status: 503, headers }); }
});
const http = httpRouter();
for (const method of ["GET", "POST", "DELETE", "OPTIONS"] as const) http.route({ pathPrefix: "/", method, handler });
export default http;
