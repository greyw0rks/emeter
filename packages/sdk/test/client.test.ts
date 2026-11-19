import { expect, it, vi } from "vitest";
import { EmeterClient } from "../src/index.js";

it("rejects an invalid gateway response instead of implying readiness", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ paidExecutionReady: true })));
  const client = new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher });
  await expect(client.getProtocolStatus()).rejects.toThrow();
});

it("propagates a gateway failure", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
  await expect(new EmeterClient({ gatewayUrl: "https://api.example.com", fetch: fetcher }).getProtocolStatus()).rejects.toThrow("503");
});
