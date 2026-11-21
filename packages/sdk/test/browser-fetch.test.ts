import { expect, it } from "vitest";
import { EmeterClient } from "../src/client.js";

it("calls fetch with its browser global receiver", async () => {
  const browserFetch: typeof fetch = async function(this: unknown, ..._args: Parameters<typeof fetch>) {
    if (this !== globalThis) throw new TypeError("Failed to execute fetch on Window: Illegal invocation");
    return new Response(JSON.stringify({ name: "emeter", phase: "protocol-validation", chainId: 196,
      paidExecutionReady: false, mainnetProofVerified: false }), { headers: { "content-type": "application/json" } });
  };
  const client = new EmeterClient({ gatewayUrl: "https://gateway.example", fetch: browserFetch });
  expect(await client.getProtocolStatus()).toMatchObject({ chainId: 196, paidExecutionReady: false });
});
