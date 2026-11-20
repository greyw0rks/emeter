import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { canonicalJson } from "@emeter/shared";
import type { GatewayConfig } from "./config.js";

export function secretHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function dispatchSignature(secret: string, path: string, timestamp: string, body: unknown) {
  return createHmac("sha256", secret).update(path + "\n" + timestamp + "\n" + canonicalJson(body)).digest("hex");
}
export function dispatchVerified(secret: string, path: string, timestamp: string, body: unknown, signature: string) {
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)
    || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(dispatchSignature(secret, path, timestamp, body), "hex"));
}

export async function checkedEndpoint(value: string, config: GatewayConfig) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !config.allowedProviderOrigins.includes(url.origin))
    throw new Error("PROVIDER_ENDPOINT_NOT_ALLOWED");
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && url.origin === config.providerOrigin))
    throw new Error("PROVIDER_TLS_REQUIRED");
  if (!loopback) {
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => {
      if (isIP(address) === 6) return !/^[23][0-9a-f]{3}:/i.test(address);
      const [a, b] = address.split(".").map(Number);
      return a === 0 || a === 10 || a === 127 || a! >= 224 || (a === 169 && b === 254)
        || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || b === 0))
        || (a === 100 && b! >= 64 && b! <= 127) || (a === 198 && (b === 18 || b === 19));
    })) throw new Error("PROVIDER_PRIVATE_ADDRESS_DENIED");
  }
  return url.href.replace(/\/$/, "");
}
