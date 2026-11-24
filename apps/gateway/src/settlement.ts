import { belongsToPayment } from "./payment-scope.js";
import { randomUUID } from "node:crypto";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, keccak256,
  TransactionReceiptNotFoundError, TransactionNotFoundError } from "viem";
import type { Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Prisma } from "@emeter/database";
import { emeterVaultAbi, fromWireCharge, jsonSafe, Tap13EnvelopeSchema, ZERO_BYTES32 } from "@emeter/shared";
import type { GatewayContext } from "./context.js";
import { fromWireOverride, WireOverrideSchema } from "./requests.js";

function contractError(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return;
  const cause = error.walk(e => e instanceof ContractFunctionRevertedError);
  if (cause instanceof ContractFunctionRevertedError) return cause.data?.errorName;
}
export async function settlementEvidence(ctx: GatewayContext, requestId: string) {
  const [row, receipt] = await Promise.all([
    ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ctx.db.usageReceipt.findUniqueOrThrow({ where: { requestId } })
  ]);
  if (!receipt.providerVerified) throw new Error("UNVERIFIED_PROVIDER_RECEIPT");
  const envelope = Tap13EnvelopeSchema.parse(receipt.envelope);
  const override = row.customerOverride ? WireOverrideSchema.parse(row.customerOverride) : undefined;
  return {
    authorization: fromWireCharge(row.authorization), chargeSignature: row.chargeSignature as Hex,
    receipt: { requestId: row.id as Hex, requestHash: row.requestHash as Hex, bodyHash: receipt.bodyHash as Hex,
      timestamp: BigInt(envelope.ts), ok: envelope.ok },
    providerSignature: envelope.sig,
    softLimitOverride: override ? fromWireOverride(override) : { sessionId: ZERO_BYTES32, chargeDigest: ZERO_BYTES32, maxTotalSpend: 0n, validUntil: 0n },
    customerOverrideSignature: override?.signature ?? "0x" as Hex
  };
}

/** Signed transaction is persisted BEFORE broadcast. Retries reuse its exact
 * nonce and hash; only the chain indexer can mark the request settled.
 */
export async function settleRequest(ctx: GatewayContext, requestId: string, account: PrivateKeyAccount) {
  if ((await ctx.db.indexerCursor.findUnique({ where: { id: ctx.config.vault.toLowerCase() } }))?.state === "reorg_detected")
    throw new Error("CHAIN_REORG_RECONCILIATION_REQUIRED");
  const row = await ctx.db.aPIRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (!belongsToPayment(ctx, row)) throw new Error("REQUEST_PAYMENT_DEPLOYMENT_MISMATCH");
  if (row.paymentStatus === "settled" || row.requestStatus !== "completed") return;
  let attempt = await ctx.db.settlementAttempt.findFirst({
    where: { requestId, status: { in: ["prepared", "submitted", "mined"] } }, orderBy: { createdAt: "desc" }
  });
  if (attempt?.status === "mined") return;
  if (!attempt) {
    const evidence = await settlementEvidence(ctx, requestId);
    try {
      const preview = await ctx.client.readContract({ address: ctx.config.vault, abi: emeterVaultAbi,
        functionName: "previewSettlement", args: [evidence] });
      if (!preview[2]) {
        await ctx.db.aPIRequest.update({ where: { id: requestId }, data: {
          paymentStatus: "denied", chargeAuthorized: false, policyInputs: preview[1], errorCode: "CIRCUIT_PAYMENT_DENIED"
        } });
        return;
      }
      await ctx.client.simulateContract({ address: ctx.config.vault, abi: emeterVaultAbi, functionName: "settle", args: [evidence], account: account.address });
      await ctx.db.aPIRequest.update({ where: { id: requestId }, data: { policyInputs: preview[1] } });
    } catch (error) {
      const name = contractError(error);
      if (name && ["AuthorizationExpired", "ReceiptExpired", "SessionUnavailable", "HardBudgetExceeded", "ChargeConsumed"].includes(name)) {
        await ctx.db.aPIRequest.update({ where: { id: requestId }, data: { paymentStatus: "failed", errorCode: name, reservationActive: false } });
        return;
      }
      throw error;
    }
    const data = encodeFunctionData({ abi: emeterVaultAbi, functionName: "settle", args: [evidence] });
    const [estimate, head, gasPrice] = await Promise.all([
      ctx.client.estimateGas({ account: account.address, to: ctx.config.vault, data }), ctx.client.getBlock(), ctx.client.getGasPrice()
    ]);
    const gas = estimate * 12n / 10n + 10_000n;
    const base = (head.baseFeePerGas ?? 0n) > gasPrice ? head.baseFeePerGas! : gasPrice;
    const maxPriorityFeePerGas = base / 10n || 1n;
    const maxFeePerGas = base * 2n + maxPriorityFeePerGas;
    const maximumGasCost = gas * maxFeePerGas;
    if (await ctx.client.getBalance({ address: account.address }) < maximumGasCost) throw new Error("RELAYER_NEEDS_GAS");
    attempt = await ctx.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "wallet:" + account.address.toLowerCase());
      const active = await tx.settlementAttempt.findFirst({ where: { status: { in: ["prepared", "submitted"] } } });
      if (active) {
        if (active.requestId === requestId) return active;
        throw new Error("RELAYER_TRANSACTION_PENDING");
      }
      const used = await tx.settlementAttempt.findMany({ where: { transactionHash: { not: null } },
        select: { actualGasCost: true, maximumGasCost: true } });
      const cost = used.reduce((sum, item) => sum + BigInt((item.actualGasCost ?? item.maximumGasCost)?.toFixed(0) ?? "0"), 0n);
      if (cost + maximumGasCost > ctx.config.settlementGasBudget) throw new Error("RELAYER_GAS_BUDGET_EXCEEDED");
      const nonce = await ctx.client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const raw = await account.signTransaction({ chainId: 196, to: ctx.config.vault, value: 0n, data,
        gas, maxFeePerGas, maxPriorityFeePerGas, nonce, type: "eip1559" });
      const prepared = await tx.settlementAttempt.create({ data: {
        id: randomUUID(), requestId, transactionHash: keccak256(raw), rawTransaction: raw, nonce: BigInt(nonce),
        maximumGasCost: maximumGasCost.toString(), evidence: jsonSafe(evidence) as Prisma.InputJsonValue, status: "prepared"
      } });
      await tx.aPIRequest.update({ where: { id: requestId }, data: { paymentStatus: "pending", chargeAuthorized: true, errorCode: null } });
      return prepared;
    }, { timeout: 20_000 });
  }
  if (!attempt.transactionHash || !attempt.rawTransaction) throw new Error("INCOMPLETE_PREPARED_TRANSACTION");
  const hash = attempt.transactionHash as Hex;
  let receipt;
  try { receipt = await ctx.client.getTransactionReceipt({ hash }); }
  catch (error) {
    if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    try {
      const sent = await ctx.client.sendRawTransaction({ serializedTransaction: attempt.rawTransaction as Hex });
      if (sent !== hash) throw new Error("BROADCAST_HASH_MISMATCH");
    } catch (error) {
      try { await ctx.client.getTransaction({ hash }); }
      catch (lookupError) { if (lookupError instanceof TransactionNotFoundError) throw error; throw lookupError; }
    }
    await ctx.db.settlementAttempt.update({ where: { id: attempt.id }, data: { status: "submitted" } });
    receipt = await ctx.client.waitForTransactionReceipt({ hash, timeout: 15_000 });
  }
  const cost = receipt.gasUsed * receipt.effectiveGasPrice;
  await ctx.db.$transaction(async tx => {
    await tx.settlementAttempt.update({ where: { id: attempt!.id }, data: {
      status: receipt.status === "success" ? "mined" : "reverted", actualGasCost: cost.toString(),
      errorCode: receipt.status === "success" ? null : "SETTLEMENT_REVERTED"
    } });
    if (receipt.status === "reverted")
      await tx.aPIRequest.update({ where: { id: requestId }, data: { paymentStatus: "failed", chargeAuthorized: false,
        errorCode: "SETTLEMENT_REVERTED", reservationActive: false } });
  });
}
