import { createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, getAddress, http } from "viem";
import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  PAYMENT_CHAIN_ID, MAX_SESSION_DURATION_SECONDS, SessionAuthorizationSchema,
  canonicalServiceIds, chargeSigningPayload, emeterRegistryAbi, emeterVaultAbi,
  overrideSigningPayload, serviceSetHash, sessionChargeDigest, sessionIdFor,
  sessionSigningPayload
} from "@emeter/shared";
import type { SessionAuthorization, SessionChargeAuthorization } from "@emeter/shared";

export type TypedDataSigner = Pick<PrivateKeyAccount, "signTypedData">;

/** Reads chain state and prepares bounded signatures; never stores a private key
 * or reports a signature/receipt as a settled payment. Wallets send prepared txs.
 */
export class EmeterSessionClient {
  private readonly client;
  readonly vault: Address;
  readonly registry: Address;

  constructor(config: { rpcUrl: string; vault: Address; registry: Address }) {
    this.vault = getAddress(config.vault);
    this.registry = getAddress(config.registry);
    this.client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  }

  private async network() {
    if (await this.client.getChainId() !== PAYMENT_CHAIN_ID) throw new Error("Wallet/RPC must use X Layer chain 196");
  }

  async getQuote(serviceId: Hex, version?: number) {
    await this.network();
    const service = await this.client.readContract({ address: this.registry, abi: emeterRegistryAbi, functionName: "getService", args: [serviceId] });
    const priceVersion = version ?? service.latestVersion;
    const [terms, active] = await Promise.all([
      this.client.readContract({ address: this.registry, abi: emeterRegistryAbi, functionName: "getPriceVersion", args: [serviceId, priceVersion] }),
      this.client.readContract({ address: this.registry, abi: emeterRegistryAbi, functionName: "isServiceAuthorized", args: [serviceId, priceVersion] })
    ]);
    return { serviceId, priceVersion, provider: service.provider, ...terms, active };
  }

  async getSession(sessionId: Hex) {
    await this.network();
    return this.client.readContract({ address: this.vault, abi: emeterVaultAbi, functionName: "getSession", args: [sessionId] });
  }

  async prepareSession(grant: SessionAuthorization, ids: readonly Hex[]) {
    await this.network();
    const authorization = SessionAuthorizationSchema.parse(grant);
    const serviceIds = canonicalServiceIds(ids);
    if (authorization.serviceSetHash.toLowerCase() !== serviceSetHash(serviceIds)) throw new Error("Signed service set does not match selected IDs");
    const [head, available, used] = await Promise.all([
      this.client.getBlock(),
      this.client.readContract({ address: this.vault, abi: emeterVaultAbi, functionName: "availableBalance", args: [authorization.customer] }),
      this.client.readContract({ address: this.vault, abi: emeterVaultAbi, functionName: "consumedSessionNonces", args: [authorization.customer, authorization.nonce] })
    ]);
    if (used) throw new Error("Session nonce already consumed");
    if (available < authorization.budget) throw new Error("Insufficient prepaid credit");
    if (authorization.expiresAt <= head.timestamp || authorization.expiresAt > head.timestamp + MAX_SESSION_DURATION_SECONDS) throw new Error("Invalid session expiration");
    const quotes = await Promise.all(serviceIds.map(id => this.getQuote(id)));
    if (quotes.some(quote => !quote.active)) throw new Error("Selected service is inactive");
    return { sessionId: sessionIdFor(this.vault, authorization.customer, authorization.nonce), authorization, serviceIds,
      typedData: sessionSigningPayload(this.vault, authorization) };
  }

  async signSession(prepared: Awaited<ReturnType<EmeterSessionClient["prepareSession"]>>, customerSigner: TypedDataSigner) {
    const signature = await customerSigner.signTypedData(prepared.typedData);
    return { ...prepared, signature, transaction: { to: this.vault,
      data: encodeFunctionData({ abi: emeterVaultAbi, functionName: "createSession", args: [prepared.authorization, prepared.serviceIds, signature] }) } };
  }

  async prepareCharge(input: { sessionId: Hex; serviceId: Hex; priceVersion?: number; requestId: Hex;
    requestHash: Hex; nonce: bigint; maxAmount?: bigint; validUntil?: bigint }) {
    await this.network();
    const [session, quote, head, used, serviceAllowed] = await Promise.all([
      this.getSession(input.sessionId), this.getQuote(input.serviceId, input.priceVersion), this.client.getBlock(),
      this.client.readContract({ address: this.vault, abi: emeterVaultAbi, functionName: "consumedChargeNonces", args: [input.sessionId, input.nonce] }),
      this.client.readContract({ address: this.vault, abi: emeterVaultAbi, functionName: "sessionServiceAllowed", args: [input.sessionId, input.serviceId] })
    ]);
    if (used) throw new Error("Charge nonce already consumed");
    if (session.status !== 1 || session.signerRevoked || head.timestamp >= session.executionDeadline) throw new Error("Session is not accepting new requests");
    if (!serviceAllowed || !quote.active) throw new Error("Service is outside the authorized session scope");
    const maxAmount = input.maxAmount ?? quote.price;
    if (maxAmount <= 0n || maxAmount > session.maxCharge || quote.price > maxAmount || quote.price > session.balance) throw new Error("Charge exceeds a signed maximum or remaining budget");
    const validUntil = input.validUntil ?? session.expiresAt;
    if (validUntil < head.timestamp || validUntil > session.expiresAt) throw new Error("Invalid request expiration");
    const authorization: SessionChargeAuthorization = {
      sessionId: input.sessionId, requestId: input.requestId, requestHash: input.requestHash,
      serviceId: input.serviceId, priceVersion: quote.priceVersion, maxAmount, nonce: input.nonce,
      issuedAt: head.timestamp, validUntil
    };
    return { authorization, quote, typedData: chargeSigningPayload(this.vault, authorization),
      requiresCustomerOverride: session.spent + quote.price > session.softLimit,
      resultingSpend: session.spent + quote.price, refundAfter: session.refundAfter };
  }

  async signCharge(prepared: Awaited<ReturnType<EmeterSessionClient["prepareCharge"]>>, sessionSigner: TypedDataSigner) {
    return { ...prepared, signature: await sessionSigner.signTypedData(prepared.typedData) };
  }

  async signOverride(charge: SessionChargeAuthorization, maxTotalSpend: bigint, validUntil: bigint, customerSigner: TypedDataSigner) {
    const session = await this.getSession(charge.sessionId);
    const quote = await this.getQuote(charge.serviceId, charge.priceVersion);
    const head = await this.client.getBlock();
    if (maxTotalSpend < session.spent + quote.price || maxTotalSpend > session.budget) throw new Error("Override is outside cumulative budget bounds");
    if (validUntil < head.timestamp || validUntil > session.refundAfter) throw new Error("Invalid override expiration");
    const authorization = { sessionId: charge.sessionId, chargeDigest: sessionChargeDigest(this.vault, charge), maxTotalSpend, validUntil };
    const typedData = overrideSigningPayload(this.vault, authorization);
    return { authorization, typedData, signature: await customerSigner.signTypedData(typedData) };
  }

  async verifyCharge(charge: SessionChargeAuthorization, signature: Hex) {
    const session = await this.getSession(charge.sessionId);
    return this.client.verifyTypedData({ ...chargeSigningPayload(this.vault, charge), address: session.signer, signature });
  }

  async verifySettlement(input: { transactionHash: Hex; authorization: SessionChargeAuthorization;
    chargeSignature: Hex; providerSignature: Hex; bodyHash: Hex; timestamp: bigint; receiptDigest: Hex;
    amount: bigint; policyInputs: number; confirmations: number }) {
    await this.network();
    const [receipt, transaction, head, quote] = await Promise.all([
      this.client.getTransactionReceipt({ hash: input.transactionHash }),
      this.client.getTransaction({ hash: input.transactionHash }), this.client.getBlockNumber({ cacheTime: 0 }),
      this.getQuote(input.authorization.serviceId, input.authorization.priceVersion)
    ]);
    if (receipt.status !== "success" || receipt.blockNumber + BigInt(input.confirmations) > head
      || transaction.to?.toLowerCase() !== this.vault.toLowerCase()) throw new Error("Settlement is not confirmed on the configured chain");
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || transaction.blockHash !== receipt.blockHash)
      throw new Error("Settlement is not in the canonical block");
    const decoded = decodeFunctionData({ abi: emeterVaultAbi, data: transaction.input });
    if (decoded.functionName !== "settle") throw new Error("Transaction is not an emeter settlement");
    const evidence = decoded.args[0];
    if (sessionChargeDigest(this.vault, evidence.authorization) !== sessionChargeDigest(this.vault, input.authorization)
      || evidence.chargeSignature.toLowerCase() !== input.chargeSignature.toLowerCase()
      || evidence.providerSignature.toLowerCase() !== input.providerSignature.toLowerCase()
      || evidence.receipt.bodyHash.toLowerCase() !== input.bodyHash.toLowerCase()
      || evidence.receipt.timestamp !== input.timestamp || !evidence.receipt.ok)
      throw new Error("Settlement transaction does not match the retained signed request");
    const matched = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== this.vault.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: emeterVaultAbi, data: log.data, topics: log.topics });
        return event.eventName === "ChargeSettled"
          && event.args.requestId.toLowerCase() === input.authorization.requestId.toLowerCase()
          && event.args.sessionId.toLowerCase() === input.authorization.sessionId.toLowerCase()
          && event.args.serviceId.toLowerCase() === input.authorization.serviceId.toLowerCase()
          && event.args.priceVersion === input.authorization.priceVersion
          && event.args.amount === input.amount && event.args.policyInputs === input.policyInputs
          && event.args.receiptDigest.toLowerCase() === input.receiptDigest.toLowerCase()
          && event.args.provider.toLowerCase() === quote.payout.toLowerCase();
      } catch { return false; }
    });
    if (!matched) throw new Error("No matching confirmed ChargeSettled event");
    return { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
  }
}
