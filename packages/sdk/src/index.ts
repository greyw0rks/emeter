import { ProtocolStatusSchema } from "@emeter/shared";
import type { ProtocolStatus } from "@emeter/shared";

export * from "./session-client.js";

/** Protocol-stage client. Paid execute() is added with the actual gateway. */
export class EmeterClient {
  private readonly gatewayUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(config: { gatewayUrl: string; fetch?: typeof fetch }) {
    const url = new URL(config.gatewayUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported gateway URL");
    this.gatewayUrl = url.href.replace(/\/$/, "");
    this.fetcher = config.fetch ?? fetch;
  }

  async getProtocolStatus(): Promise<ProtocolStatus> {
    const response = await this.fetcher(`${this.gatewayUrl}/api/protocol`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
    return ProtocolStatusSchema.parse(await response.json());
  }
}
