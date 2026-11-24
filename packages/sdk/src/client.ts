import { z } from "zod";
import { keccak256, parseUnits, toHex } from "viem";
import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  AddressSchema, canonicalJson, ClientIdSchema, fromWireCharge, GatewayRequestRecordSchema,
  HashSchema, jsonSafe, manifestHash, ProtocolStatusSchema, requestHash, ServiceManifestSchema,
  verifyAiEvidence, verifyTap13Response, readJsonBody, parseStrictJson, X_LAYER
} from "@emeter/shared";
import type { JsonValue, ProtocolStatus, ServiceCall, ServiceManifest } from "@emeter/shared";
import { EmeterSessionClient } from "./session-client.js";
import type { TypedDataSigner } from "./session-client.js";

export const GatewayNetworkSchema = ProtocolStatusSchema.extend({
  vault: AddressSchema, registry: AddressSchema, token: AddressSchema, decimals: z.literal(6),
  symbol: z.enum(["USDC", "DEMO"]).optional(),
  rpcUrl: z.string().url(), confirmations: z.number().int().min(1).max(128),
  networkMode: z.enum(["mainnet", "local-fork"]),
  anchor: z.object({ blockNumber: z.string().regex(/^[0-9]+$/), blockHash: HashSchema, timestamp: z.string().regex(/^[0-9]+$/) }).optional()
});
const networkSchema = GatewayNetworkSchema;
export type GatewayNetwork = z.infer<typeof GatewayNetworkSchema>;
const serviceSchema = z.object({
  id: HashSchema, name: z.string(), method: z.string(), endpoint: z.string().url(), manifest: ServiceManifestSchema,
  priceVersion: z.number().int().positive(), priceBaseUnits: z.string(),
  signer: AddressSchema, container: AddressSchema, payout: AddressSchema, active: z.boolean()
}).passthrough();
type Service = z.infer<typeof serviceSchema>;
type WalletIdentity = Pick<PrivateKeyAccount, "address" | "signMessage">;
type CustomerSigner = WalletIdentity & TypedDataSigner;
export class EmeterGatewayError extends Error {
  constructor(public status: number, public code: string, public requestId?: Hex) {
    super(String(status) + " " + code);
  }
}
export type EmeterResult<T = unknown> = z.infer<typeof GatewayRequestRecordSchema> & {
  data: T; receiptVerified: boolean; settlementVerified: boolean;
};
export type ExecuteInput = {
  serviceId: string; input: JsonValue; maxCharge: string; requestId?: string; nonce?: bigint; priceVersion?: number;
  overrideSoftLimit?: boolean; maximumTotalSpend?: bigint; awaitSettlement?: boolean; timeoutMs?: number;
};
type PreparedRequest = { call: ServiceCall; manifest: ServiceManifest; payload: {
  call: ServiceCall; authorization: unknown; signature: Hex; customerOverride?: unknown
} };

export class EmeterClient {
  private readonly gatewayUrl: string;
  private readonly fetcher: typeof fetch;
  private token: string | undefined;
  private readonly config;
  private readonly prepared = new Map<string, PreparedRequest>();
  constructor(config: {
    gatewayUrl: string; fetch?: typeof fetch; sessionSigner?: TypedDataSigner; sessionId?: Hex;
    customerSigner?: CustomerSigner; rpcUrl?: string; vault?: Address; registry?: Address; token?: string
  }) {
    const url = new URL(config.gatewayUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search)
      throw new Error("Unsupported gateway URL");
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Public gateways require HTTPS");
    this.gatewayUrl = url.href.replace(/\/$/, "");
    this.fetcher = (config.fetch ?? globalThis.fetch).bind(globalThis);
    this.config = config;
    if (config.token) this.token = config.token;
  }

  private async http(path: string, body?: unknown, method?: string) {
    const response = await this.fetcher(this.gatewayUrl + path, {
      method: method ?? (body === undefined ? "GET" : "POST"), redirect: "error",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.token ? { authorization: "Bearer " + this.token } : {}) },
      ...(body === undefined ? {} : { body: canonicalJson(jsonSafe(body)) }),
      signal: AbortSignal.timeout(35_000)
    });
    let result: unknown;
    try { result = parseStrictJson(await readJsonBody(response)); }
    catch {
      if (!response.ok) throw new EmeterGatewayError(response.status, "GATEWAY_HTTP_ERROR");
      throw new Error("INVALID_GATEWAY_RESPONSE");
    }
    if (!response.ok) throw new EmeterGatewayError(response.status,
      typeof result === "object" && result !== null && "error" in result ? String(result.error) : "GATEWAY_HTTP_ERROR");
    return result;
  }

  async getProtocolStatus(): Promise<ProtocolStatus> { return ProtocolStatusSchema.parse(await this.http("/api/protocol")); }
  async getNetwork(): Promise<GatewayNetwork> { return GatewayNetworkSchema.parse(await this.http("/api/protocol")); }
  async getAccount() { return this.http("/api/account"); }
  async getSession(sessionId: Hex) { return this.http("/api/sessions/" + HashSchema.parse(sessionId)); }
  async verifyRequest<T = unknown>(requestId: Hex): Promise<EmeterResult<T>> {
    const result = await this.getRequest<T>(requestId), network = await this.getNetwork();
    if ((this.config.vault && this.config.vault.toLowerCase() !== network.vault.toLowerCase())
      || (this.config.registry && this.config.registry.toLowerCase() !== network.registry.toLowerCase()))
      throw new Error("Gateway deployment does not match configured contracts");
    if (network.networkMode === "local-fork" && !this.config.rpcUrl) throw new Error("Configure the local fork RPC explicitly");
    return this.verifyResult(result, new EmeterSessionClient({ rpcUrl: this.config.rpcUrl ?? X_LAYER.rpcUrl,
      vault: network.vault, registry: network.registry }), network.confirmations);
  }
  async authenticate(identity: WalletIdentity) {
    const challenge = z.object({ id: z.string().uuid(), message: z.string(), expiresAt: z.string() }).parse(
      await this.http("/api/auth/challenge", { wallet: identity.address }));
    const expected = "emeter gateway authentication\nOrigin: " + new URL(this.gatewayUrl).origin
      + "\nChain ID: 196\nWallet: " + identity.address.toLowerCase() + "\nNonce: " + challenge.id
      + "\nExpires at: " + challenge.expiresAt;
    const expires = Date.parse(challenge.expiresAt);
    if (challenge.message !== expected || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 330_000)
      throw new Error("Invalid gateway authentication challenge");
    const signature = await identity.signMessage({ message: challenge.message });
    const result = z.object({ token: z.string(), wallet: z.string(), expiresAt: z.string() }).parse(
      await this.http("/api/auth/verify", { id: challenge.id, signature }));
    if (result.wallet.toLowerCase() !== identity.address.toLowerCase()) throw new Error("Authentication wallet mismatch");
    this.token = result.token;
    return { wallet: result.wallet, expiresAt: result.expiresAt };
  }
  async logout() { const result = await this.http("/api/auth/logout", {}); this.token = undefined; return result; }
  setCredential(token: string) {
    if (!token || /\s/.test(token)) throw new Error("Invalid credential");
    this.token = token;
  }
  async createApiKey(input: { serviceId?: Hex; sessionId?: Hex; scopes: ("execute" | "usage:read" | "request:read")[] }) {
    return z.object({ id: z.string().uuid(), key: z.string(), serviceId: HashSchema.nullable(), sessionId: HashSchema.nullable(),
      scopes: z.array(z.string()), expiresAt: z.string().nullable(), displayOnce: z.literal(true)
    }).parse(await this.http("/api/keys", input));
  }
  async revokeApiKey(id: string) { return this.http("/api/keys/" + z.string().uuid().parse(id), undefined, "DELETE"); }
  async getKeys() { return this.http("/api/keys"); }
  async getServices(): Promise<Service[]> {
    return z.object({ services: z.array(serviceSchema) }).parse(await this.http("/api/services")).services;
  }
  async getRequest<T = unknown>(requestId: Hex): Promise<EmeterResult<T>> {
    const result = GatewayRequestRecordSchema.parse(await this.http("/api/requests/" + HashSchema.parse(requestId)));
    if (result.requestId !== requestId.toLowerCase()) throw new Error("Gateway returned another request");
    return { ...result, receiptVerified: false, settlementVerified: false } as EmeterResult<T>;
  }
  async getReceipt(requestId: Hex) { return this.http("/api/receipts/" + HashSchema.parse(requestId)); }
  async getUsage() { return this.http("/api/dashboard/usage"); }
  async registerService(manifest: unknown, priceVersion?: number) {
    return this.http("/api/services", { manifest, ...(priceVersion === undefined ? {} : { priceVersion }) });
  }
  async prepareSession(input: {
    signer: Address; budget: bigint; softLimit: bigint; maxCharge: bigint;
    expiresAt: bigint; settlementWindow: bigint; nonce: bigint; serviceIds: Hex[]
  }) { return this.http("/api/sessions", input); }
  async recoverRequest(requestId: Hex) { return this.http("/api/requests/" + HashSchema.parse(requestId) + "/recover", {}); }
  async requestSettlement(requestId: Hex, customerOverride?: unknown) {
    return this.http("/api/settlements", { requestId, ...(customerOverride ? { customerOverride } : {}) });
  }

  private checkInput(call: ServiceCall, authorization: unknown, manifest: ServiceManifest, input: ExecuteInput) {
    const charge = fromWireCharge(authorization);
    const slug = new URL(manifest.endpoint).pathname.split("/").pop();
    if (input.serviceId.toLowerCase() !== charge.serviceId && input.serviceId !== slug
      || charge.sessionId.toLowerCase() !== this.config.sessionId?.toLowerCase()
      || canonicalJson(call.params.input) !== canonicalJson(input.input)
      || charge.maxAmount !== parseUnits(input.maxCharge, 6)
      || input.priceVersion !== undefined && charge.priceVersion !== input.priceVersion
      || input.nonce !== undefined && charge.nonce !== input.nonce)
      throw new EmeterGatewayError(409, "IDEMPOTENCY_CONFLICT", charge.requestId);
  }

  private async verifyResult<T>(result: EmeterResult<T>, sessions: EmeterSessionClient, confirmations: number) {
    const charge = fromWireCharge(result.authorization);
    const call = result.call as ServiceCall;
    const quote = await sessions.getQuote(result.serviceId, result.priceVersion);
    if (charge.sessionId !== result.sessionId || charge.serviceId !== result.serviceId || charge.requestId !== result.requestId
      || charge.priceVersion !== result.priceVersion || charge.requestHash !== requestHash(call) || result.requestHash !== requestHash(call)
      || keccak256(toHex(call.id)) !== result.requestId || call.id !== result.clientId
      || call.params.sessionId !== result.sessionId || call.params.serviceId !== result.serviceId
      || call.params.priceVersion !== result.priceVersion || call.method !== result.serviceManifest.method
      || manifestHash(result.serviceManifest).toLowerCase() !== quote.metadataHash.toLowerCase()
      || result.priceBaseUnits !== quote.price.toString() || quote.price > charge.maxAmount)
      throw new Error("Gateway request or immutable service terms do not match the authorization");
    if (result.paymentStatus !== "settled" && !await sessions.verifyCharge(charge, result.chargeSignature))
      throw new Error("Stored session authorization signature is invalid");
    if (!result.receipt) {
      if (result.requestStatus === "completed" || result.paymentStatus === "settled" || result.data !== null)
        throw new Error("A result requires a signed provider receipt");
      return result;
    }
    const checked = await verifyTap13Response({
      call, container: quote.container, signer: quote.signer, httpStatus: 200,
      body: canonicalJson(result.receipt.envelope), now: result.receipt.envelope.ts
    });
    if ((checked.outcome !== "accepted_result" && checked.outcome !== "accepted_error") || !checked.envelope || !checked.receipt
      || checked.digest !== result.receipt.digest || checked.receipt.bodyHash !== result.receipt.bodyHash
      || checked.receipt.timestamp < charge.issuedAt || checked.receipt.timestamp > charge.validUntil
      || canonicalJson(result.data) !== canonicalJson(checked.envelope.ok ? checked.envelope.result : checked.envelope.error)
      || result.requestStatus === "completed" && !checked.envelope.ok)
      throw new Error("Provider receipt verification failed");
    if (checked.envelope.ok && call.method === "text_analyze") {
      const body = result.data as Record<string, unknown>;
      await verifyAiEvidence(body.usageEvidence, { container: quote.container, signer: quote.signer,
        text: (call.params.input as Record<string, JsonValue>).text as string, analysis: body.analysis });
    }
    result.receiptVerified = true;
    if (result.paymentStatus === "settled") {
      if (!checked.envelope.ok || !result.transaction || result.transaction.confirmationStatus !== "confirmed"
        || result.transaction.policyInputs === undefined) throw new Error("Settlement confirmation is missing");
      const verified = await sessions.verifySettlement({
        transactionHash: result.transaction.hash, authorization: charge, chargeSignature: result.chargeSignature,
        providerSignature: checked.envelope.sig, bodyHash: checked.receipt.bodyHash, timestamp: checked.receipt.timestamp,
        receiptDigest: checked.digest!, amount: quote.price, policyInputs: result.transaction.policyInputs, confirmations
      });
      if (verified.blockNumber.toString() !== result.transaction.blockNumber) throw new Error("Settlement block mismatch");
      result.settlementVerified = true;
    }
    return result;
  }

  async execute<T = unknown>(input: ExecuteInput): Promise<EmeterResult<T>> {
    if (!this.token || !this.config.sessionId) throw new Error("Authenticate and configure a spending session before execution");
    if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(input.maxCharge))
      throw new Error("maxCharge must be an exact payment amount with at most six decimal places");
    const timeout = input.timeoutMs ?? 90_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) throw new Error("Invalid execution timeout");
    const network = networkSchema.parse(await this.http("/api/protocol"));
    if ((this.config.vault && this.config.vault.toLowerCase() !== network.vault.toLowerCase())
      || (this.config.registry && this.config.registry.toLowerCase() !== network.registry.toLowerCase()))
      throw new Error("Gateway deployment does not match configured contracts");
    if (network.networkMode === "local-fork" && !this.config.rpcUrl)
      throw new Error("Configure the local fork RPC explicitly");
    const sessions = new EmeterSessionClient({
      rpcUrl: this.config.rpcUrl ?? X_LAYER.rpcUrl, vault: network.vault, registry: network.registry
    });
    const clientId = ClientIdSchema.parse(input.requestId ?? crypto.randomUUID());
    const requestId = keccak256(toHex(clientId));
    let result: EmeterResult<T> | undefined;
    if (input.requestId) {
      try { result = await this.getRequest<T>(requestId); }
      catch (error) { if (!(error instanceof EmeterGatewayError) || error.status !== 404) throw error; }
      if (result) this.checkInput(result.call as ServiceCall, result.authorization, result.serviceManifest, input);
    }
    if (!result) {
      if (!network.paidExecutionReady) throw new EmeterGatewayError(503, "GATEWAY_NOT_READY");
      let saved = this.prepared.get(clientId);
      if (saved) this.checkInput(saved.call, saved.payload.authorization, saved.manifest, input);
      else {
        if (!this.config.sessionSigner) throw new Error("Configure a delegated session signer");
        const services = await this.getServices();
        const service = services.find(s => s.id === input.serviceId.toLowerCase()
          || new URL(s.endpoint).pathname.split("/").pop() === input.serviceId);
        if (!service) throw new Error("Unknown service");
        const version = input.priceVersion ?? service.priceVersion;
        const manifest = version === service.priceVersion ? service.manifest
          : z.object({ manifest: ServiceManifestSchema }).parse(
            await this.http("/api/services/" + service.id + "/manifest?version=" + version)).manifest;
        const random = crypto.getRandomValues(new Uint8Array(32));
        const nonce = input.nonce ?? BigInt("0x" + Array.from(random, b => b.toString(16).padStart(2, "0")).join(""));
        const call: ServiceCall = { id: clientId, method: manifest.method, params: {
          sessionId: this.config.sessionId.toLowerCase(), serviceId: service.id, priceVersion: version, input: input.input
        } };
        const prepared = await sessions.prepareCharge({
          sessionId: this.config.sessionId, serviceId: service.id, priceVersion: version,
          requestId, requestHash: requestHash(call), nonce, maxAmount: parseUnits(input.maxCharge, 6)
        });
        if (manifestHash(manifest).toLowerCase() !== prepared.quote.metadataHash.toLowerCase())
          throw new Error("Service manifest does not match the signed onchain price version");
        const signed = await sessions.signCharge(prepared, this.config.sessionSigner);
        let customerOverride;
        if (input.overrideSoftLimit) {
          if (!this.config.customerSigner) throw new Error("A customer signer is required for a soft-limit override");
          const grant = await sessions.signOverride(signed.authorization, input.maximumTotalSpend ?? prepared.resultingSpend,
            prepared.refundAfter, this.config.customerSigner);
          customerOverride = { ...grant.authorization, signature: grant.signature };
        } else if (prepared.requiresCustomerOverride)
          throw new Error("The request requires an explicit customer soft-limit override");
        saved = { call, manifest, payload: { call, authorization: signed.authorization, signature: signed.signature,
          ...(customerOverride ? { customerOverride } : {}) } };
        if (this.prepared.size >= 256) this.prepared.delete(this.prepared.keys().next().value!);
        this.prepared.set(clientId, saved);
      }
      try {
        const raw = await this.http("/api/execute/" + saved.call.params.serviceId, saved.payload);
        result = { ...GatewayRequestRecordSchema.parse(raw), receiptVerified: false, settlementVerified: false } as EmeterResult<T>;
      } catch (error) {
        if (error instanceof EmeterGatewayError && error.status < 500) throw error;
        // A timeout may follow acceptance. Recover before retrying the exact
        // signed payload; never allocate another nonce for this request id.
        try { result = await this.getRequest<T>(requestId); }
        catch (lookupError) {
          if (!(lookupError instanceof EmeterGatewayError) || lookupError.status !== 404) throw error;
          const raw = await this.http("/api/execute/" + saved.call.params.serviceId, saved.payload);
          result = { ...GatewayRequestRecordSchema.parse(raw), receiptVerified: false, settlementVerified: false } as EmeterResult<T>;
        }
      }
    }
    if (result.requestId !== requestId || result.sessionId.toLowerCase() !== this.config.sessionId.toLowerCase())
      throw new Error("Gateway returned another request");
    this.checkInput(result.call as ServiceCall, result.authorization, result.serviceManifest, input);
    const deadline = Date.now() + timeout;
    const done = () => result!.requestStatus === "failed" || result!.requestStatus === "indeterminate"
      || (result!.requestStatus === "completed"
        && (input.awaitSettlement === false || ["settled", "denied", "failed"].includes(result!.paymentStatus)));
    while (!done()) {
      if (Date.now() >= deadline) throw new EmeterGatewayError(408, "REQUEST_STATUS_TIMEOUT", requestId);
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
      result = await this.getRequest<T>(requestId);
    }
    return this.verifyResult(result, sessions, network.confirmations);
  }
}
