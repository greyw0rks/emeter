"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, keccak256, parseAbi, toHex } from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { EmeterClient, EmeterGatewayError, EmeterSessionClient } from "@emeter/sdk";
import type { EmeterResult, GatewayNetwork, TypedDataSigner } from "@emeter/sdk";
import { AddressSchema, canonicalJson, HashSchema, ServiceManifestSchema, serviceSetHash, X_LAYER } from "@emeter/shared";
import type { JsonValue, ServiceManifest } from "@emeter/shared";
import { emeterRegistryAbi, emeterVaultAbi } from "@emeter/shared";
import { AccountSchema, KeysSchema, UsageSchema } from "../lib/models";
import type { AccountSummary, ApiCredential, SpendingSession } from "../lib/models";
import { assertDeployment, assertRpcAnchor, assertWalletAnchor, DEPLOYMENT, exactDemo, paymentChain, publicUrl, randomNonce } from "../lib/wallet";
import type { BrowserWallet, PendingTransaction } from "../lib/wallet";
import { errorMessage } from "../lib/errors";

type PublicConfig = { gatewayUrl: string; rpcUrl?: string };
export type CatalogService = Awaited<ReturnType<EmeterClient["getServices"]>>[number];
type Delegate = { signer: PrivateKeyAccount; client?: EmeterClient; keyId?: string };
type RunInput = { sessionId: Hex; serviceId: Hex; priceVersion: number; input: JsonValue; maxCharge: string; maximumTotalSpend?: bigint };
type Operation = RunInput & { clientId: string; requestId: Hex; client: EmeterClient };
export type ExecutionState = { requestId: Hex; clientId: string; sessionId: Hex; serviceId: Hex;
  phase: "authorizing" | "running" | "finished" | "unresolved"; record?: EmeterResult; error?: string };
type GatewayValue = {
  config: PublicConfig | undefined; network: GatewayNetwork | undefined; services: CatalogService[]; account: AccountSummary | undefined;
  address: Address | undefined; signedIn: boolean; reachable: boolean; busy: string | undefined; error: string | undefined; notice: string | undefined; loading: boolean;
  refreshedAt: string | undefined; pending: PendingTransaction | undefined; execution: ExecutionState | undefined;
  refresh: () => Promise<void>; connect: () => Promise<void>; disconnect: () => void; clearError: () => void;
  deposit: (amount: string) => Promise<void>; withdraw: (amount: string) => Promise<void>;
  createSession: (limits: { budget: string; softLimit: string; maxCharge: string; minutes: number; serviceIds: Hex[] }) => Promise<Hex>;
  manageSession: (id: Hex, action: "closeSession" | "revokeSessionSigner" | "refund") => Promise<void>;
  hasSessionKey: (id: Hex) => boolean;
  execute: (input: RunInput) => Promise<void>; recoverExecution: () => Promise<void>; clearExecution: () => void;
  verifyRequest: (id: Hex) => Promise<EmeterResult>; recoverRequest: (id: Hex) => Promise<void>;
  approveSettlement: (id: Hex, maximumTotalSpend: bigint) => Promise<void>;
  getKeys: () => Promise<ApiCredential[]>;
  createKey: (input: { serviceId?: Hex; sessionId?: Hex; scopes: ("execute" | "usage:read" | "request:read")[] }) => Promise<{ id: string; key: string }>;
  revokeKey: (id: string) => Promise<void>; getUsage: () => Promise<z.infer<typeof UsageSchema>>;
  registerService: (manifest: ServiceManifest) => Promise<void>; checkPending: (hash?: string) => Promise<void>;
};
const Gateway = createContext<GatewayValue | null>(null);
const tokenAbi = parseAbi(["function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"]);
const PendingSchema = z.object({ hash: HashSchema.nullable(), label: z.string(), from: AddressSchema, to: AddressSchema,
  dataHash: HashSchema, rpcUrl: z.string().url(), mode: z.enum(["mainnet", "local-fork"]) });

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>();
  const [network, setNetwork] = useState<GatewayNetwork>();
  const [services, setServices] = useState<CatalogService[]>([]);
  const [account, setAccount] = useState<AccountSummary>();
  const [address, setAddress] = useState<Address>();
  const [signedIn, setSignedIn] = useState(false);
  const [reachable, setReachable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [refreshedAt, setRefreshedAt] = useState<string>();
  const [pending, setPendingState] = useState<PendingTransaction>();
  const [execution, setExecution] = useState<ExecutionState>();
  const [keyRevision, setKeyRevision] = useState(0);
  const cfg = useRef<PublicConfig | undefined>(undefined);
  const client = useRef<EmeterClient | undefined>(undefined);
  const wallet = useRef<BrowserWallet | undefined>(undefined);
  const owner = useRef<Address | undefined>(undefined);
  const auth = useRef(false);
  const generation = useRef(0);
  const working = useRef(false);
  const refreshing = useRef(false);
  const delegates = useRef(new Map<Hex, Delegate>());
  const transaction = useRef<PendingTransaction | undefined>(undefined);
  const operation = useRef<Operation | undefined>(undefined);
  const currentAccount = useRef<AccountSummary | undefined>(undefined);
  const connectionError = useRef<string | undefined>(undefined);

  const setPending = useCallback((value?: PendingTransaction) => {
    transaction.current = value; setPendingState(value);
    try { if (value) sessionStorage.setItem("emeter-pending-transaction", JSON.stringify(value));
      else sessionStorage.removeItem("emeter-pending-transaction"); } catch { /* The in-memory lock still protects this tab. */ }
  }, []);
  const resetIdentity = useCallback(() => {
    generation.current++; auth.current = false; owner.current = undefined; delegates.current.clear(); operation.current = undefined;
    setAddress(undefined); setSignedIn(false); setAccount(undefined); currentAccount.current = undefined; setExecution(undefined);
    if (cfg.current) client.current = new EmeterClient({ gatewayUrl: cfg.current.gatewayUrl });
    setKeyRevision(value => value + 1);
  }, []);
  const requireAuth = useCallback(() => {
    if (!auth.current || !client.current || !owner.current || !wallet.current) throw new Error("AUTH_REQUIRED");
    return { client: client.current, address: owner.current, wallet: wallet.current, epoch: generation.current };
  }, []);
  const ensureEpoch = useCallback((epoch: number) => {
    if (epoch !== generation.current) throw new Error("WALLET_SESSION_CHANGED");
  }, []);
  const live = useCallback(async () => {
    if (!cfg.current || !client.current) throw new Error("GATEWAY_UNAVAILABLE");
    const next = await client.current.getNetwork();
    assertDeployment(next);
    const rpcUrl = cfg.current.rpcUrl ?? (next.networkMode === "mainnet" ? X_LAYER.rpcUrl : undefined);
    if (!rpcUrl) throw new Error("LOCAL_RPC_REQUIRED");
    await assertRpcAnchor(next, rpcUrl);
    setNetwork(next);
    return { network: next, rpcUrl, rpc: createPublicClient({ chain: paymentChain(rpcUrl), transport: http(rpcUrl) }) };
  }, []);
  const refresh = useCallback(async () => {
    if (!client.current || refreshing.current) return;
    refreshing.current = true;
    const epoch = generation.current;
    try {
      const current = await client.current.getNetwork();
      assertDeployment(current); setNetwork(current);
      const list = await client.current.getServices();
      ensureEpoch(epoch); setServices(list);
      if (auth.current) {
        const summary = AccountSchema.parse(await client.current.getAccount());
        ensureEpoch(epoch);
        if (summary.wallet.toLowerCase() !== owner.current?.toLowerCase()) throw new Error("WALLET_ACCOUNT_CHANGED");
        currentAccount.current = summary; setAccount(summary);
      }
      setRefreshedAt(new Date().toISOString());
      setReachable(true);
      if (connectionError.current) { const previousConnection = connectionError.current;
        setError(previous => previous === previousConnection ? undefined : previous); connectionError.current = undefined; }
    } catch (failure) {
      if (epoch === generation.current) {
        if (failure instanceof EmeterGatewayError && failure.status === 401 && auth.current) {
          resetIdentity(); setNotice("Wallet login expired. Connect and sign in again.");
        } else { const message = errorMessage(failure); connectionError.current = message; setError(message); setReachable(false); }
      }
    } finally { refreshing.current = false; setLoading(false); }
  }, [ensureEpoch, resetIdentity]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/config", { cache: "no-store" });
        if (!response.ok) throw new Error("INVALID_PUBLIC_CONFIGURATION");
        const parsed = z.object({ gatewayUrl: z.string(), rpcUrl: z.string().optional() }).parse(await response.json());
        const value = { gatewayUrl: publicUrl(parsed.gatewayUrl), ...(parsed.rpcUrl ? { rpcUrl: publicUrl(parsed.rpcUrl) } : {}) };
        if (cancelled) return;
        cfg.current = value; setConfig(value); client.current = new EmeterClient({ gatewayUrl: value.gatewayUrl });
        try {
          const stored = sessionStorage.getItem("emeter-pending-transaction");
          if (stored) {
            const retained = PendingSchema.parse(JSON.parse(stored));
            if ([DEPLOYMENT.vault, DEPLOYMENT.registry, DEPLOYMENT.token].some(to => to.toLowerCase() === retained.to.toLowerCase()))
              setPending(retained);
          }
        } catch { /* Ignore malformed storage; never use it to authorize a transaction. */ }
        await refresh();
      } catch (failure) { if (!cancelled) { setError(errorMessage(failure)); setLoading(false); } }
    })();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh, setPending]);
  useEffect(() => {
    const provider = wallet.current;
    if (!provider) return;
    const changed = () => { resetIdentity(); setNotice("Wallet changed. Sign in again; tab session keys were cleared."); };
    provider.on?.("accountsChanged", changed); provider.on?.("chainChanged", changed); provider.on?.("disconnect", changed);
    return () => {
      provider.removeListener?.("accountsChanged", changed); provider.removeListener?.("chainChanged", changed); provider.removeListener?.("disconnect", changed);
    };
  }, [address, resetIdentity]);

  const perform = useCallback(async <T,>(label: string, action: () => Promise<T>) => {
    if (working.current) throw new Error("An operation is already in progress.");
    working.current = true; setBusy(label); setError(undefined); setNotice(undefined);
    try { return await action(); }
    catch (failure) { setError(errorMessage(failure) + (failure instanceof Error && failure.message === "WALLET_NETWORK_MISMATCH"
      ? " Expected wallet RPC: " + (cfg.current?.rpcUrl ?? X_LAYER.rpcUrl) + "." : "")); throw failure; }
    finally { working.current = false; setBusy(undefined); }
  }, []);
  const customerSigner = useCallback((provider: BrowserWallet, accountAddress: Address, epoch: number) => {
    const signing = createWalletClient({ account: accountAddress, transport: custom(provider), chain: paymentChain(cfg.current?.rpcUrl ?? X_LAYER.rpcUrl) });
    const typed: TypedDataSigner = {
      signTypedData: async payload => {
        ensureEpoch(epoch);
        const current = await live(); await assertWalletAnchor(provider, current.network, accountAddress);
        const domain = z.object({ domain: z.object({ chainId: z.union([z.literal(196), z.literal(196n)]), verifyingContract: AddressSchema }) }).parse(payload).domain;
        if (domain.verifyingContract.toLowerCase() !== DEPLOYMENT.vault.toLowerCase())
          throw new Error("DEPLOYMENT_MISMATCH");
        const signature = await signing.signTypedData(payload as unknown as Parameters<typeof signing.signTypedData>[0]);
        ensureEpoch(epoch); await assertWalletAnchor(provider, (await live()).network, accountAddress);
        return signature;
      }
    };
    return { address: accountAddress, ...typed,
      signMessage: async (input: { message: string | { raw: Hex | Uint8Array } }) => {
        ensureEpoch(epoch); await assertWalletAnchor(provider, (await live()).network, accountAddress);
        const signature = await signing.signMessage(input); ensureEpoch(epoch); return signature;
      }
    };
  }, [ensureEpoch, live]);
  const connect = useCallback(() => perform("Connecting wallet", async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error("NO_WALLET");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const selected = AddressSchema.parse(accounts[0]);
    resetIdentity(); const epoch = generation.current;
    wallet.current = provider; owner.current = selected; setAddress(selected);
    const current = await live(); await assertWalletAnchor(provider, current.network, selected);
    const signer = customerSigner(provider, selected, epoch);
    const authenticated = new EmeterClient({ gatewayUrl: cfg.current!.gatewayUrl, rpcUrl: current.rpcUrl,
      vault: DEPLOYMENT.vault, registry: DEPLOYMENT.registry, customerSigner: signer });
    await authenticated.authenticate(signer); ensureEpoch(epoch);
    client.current = authenticated; auth.current = true; setSignedIn(true);
    setNotice("Wallet signed in. No spending permission was granted by this login."); await refresh();
  }), [customerSigner, ensureEpoch, live, perform, refresh, resetIdentity]);
  const disconnect = useCallback(() => {
    const previous = client.current;
    resetIdentity(); setNotice("Disconnected. Tab signing keys were cleared.");
    void previous?.logout().catch(() => undefined);
  }, [resetIdentity]);

  const confirmTransaction = useCallback(async (retained: PendingTransaction, hash: Hex) => {
    const current = await live();
    if (retained.rpcUrl !== current.rpcUrl || retained.mode !== current.network.networkMode) throw new Error("PENDING_NETWORK_CHANGED");
    const receipt = await current.rpc.waitForTransactionReceipt({ hash, confirmations: current.network.confirmations + 1, timeout: 90_000, pollingInterval: 500 });
    const [tx, block] = await Promise.all([current.rpc.getTransaction({ hash }), current.rpc.getBlock({ blockNumber: receipt.blockNumber })]);
    if (tx.from.toLowerCase() !== retained.from.toLowerCase() || tx.to?.toLowerCase() !== retained.to.toLowerCase()
      || keccak256(tx.input) !== retained.dataHash || tx.value !== 0n || block.hash !== receipt.blockHash || tx.blockHash !== block.hash)
      throw new Error("TRANSACTION_BINDING_MISMATCH");
    setPending(undefined);
    if (receipt.status !== "success") throw new Error("TRANSACTION_REVERTED");
    setNotice(retained.label + " confirmed."); await refresh();
  }, [live, refresh, setPending]);
  const send = useCallback(async (label: string, to: Address, data: Hex) => {
    if (transaction.current) throw new Error("PENDING_TRANSACTION");
    const identity = requireAuth(); const current = await live();
    ensureEpoch(identity.epoch); await assertWalletAnchor(identity.wallet, current.network, identity.address);
    const retained: PendingTransaction = { hash: null, label, from: identity.address, to,
      dataHash: keccak256(data), rpcUrl: current.rpcUrl, mode: current.network.networkMode };
    setPending(retained);
    try {
      const signing = createWalletClient({ chain: paymentChain(current.rpcUrl), account: identity.address, transport: custom(identity.wallet) });
      const hash = await signing.sendTransaction({ to, data, value: 0n });
      retained.hash = hash; setPending({ ...retained });
      ensureEpoch(identity.epoch);
      await assertWalletAnchor(identity.wallet, (await live()).network, identity.address);
      await confirmTransaction(retained, hash);
    } catch (failure) {
      if (!retained.hash) {
        if (failure && typeof failure === "object" && (("code" in failure && failure.code === 4001)
          || /rejected|denied.*user|user.*denied/i.test(failure instanceof Error ? failure.message : ""))) setPending(undefined);
        else throw new Error("UNKNOWN_BROADCAST");
      }
      throw failure;
    }
  }, [confirmTransaction, ensureEpoch, live, requireAuth, setPending]);
  const deposit = useCallback((amount: string) => perform("Depositing DEMO", async () => {
    const units = exactDemo(amount), identity = requireAuth(), current = await live();
    const [balance, allowance] = await Promise.all([
      current.rpc.readContract({ address: DEPLOYMENT.token, abi: tokenAbi, functionName: "balanceOf", args: [identity.address] }),
      current.rpc.readContract({ address: DEPLOYMENT.token, abi: tokenAbi, functionName: "allowance", args: [identity.address, DEPLOYMENT.vault] })
    ]);
    if (balance < units) throw new Error("INSUFFICIENT_DEMO");
    if (allowance < units) await send("Exact DEMO approval", DEPLOYMENT.token,
      encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [DEPLOYMENT.vault, units] }));
    ensureEpoch(identity.epoch);
    await send("Credit deposit", DEPLOYMENT.vault, encodeFunctionData({ abi: emeterVaultAbi, functionName: "deposit", args: [units] }));
  }), [ensureEpoch, live, perform, requireAuth, send]);
  const withdraw = useCallback((amount: string) => perform("Withdrawing available credit", async () => {
    await send("Credit withdrawal", DEPLOYMENT.vault,
      encodeFunctionData({ abi: emeterVaultAbi, functionName: "withdrawAvailable", args: [exactDemo(amount)] }));
  }), [perform, send]);
  const createSession = useCallback((limits: { budget: string; softLimit: string; maxCharge: string; minutes: number; serviceIds: Hex[] }) =>
    perform("Authorizing session", async () => {
      const identity = requireAuth(); const current = await live();
      const budget = exactDemo(limits.budget), softLimit = exactDemo(limits.softLimit, true), maxCharge = exactDemo(limits.maxCharge);
      if (softLimit > budget || maxCharge > budget || limits.serviceIds.length === 0 || limits.serviceIds.length > 16
        || !Number.isInteger(limits.minutes) || limits.minutes < 1 || limits.minutes > 43_200) throw new Error("INVALID_SESSION_LIMITS");
      const signer = privateKeyToAccount(generatePrivateKey());
      const sessions = new EmeterSessionClient({ rpcUrl: current.rpcUrl, vault: DEPLOYMENT.vault, registry: DEPLOYMENT.registry });
      const prepared = await sessions.prepareSession({ customer: identity.address, signer: signer.address, budget, softLimit, maxCharge,
        expiresAt: BigInt(current.network.anchor!.timestamp) + BigInt(limits.minutes * 60), settlementWindow: 120n,
        serviceSetHash: serviceSetHash(limits.serviceIds), nonce: randomNonce() }, limits.serviceIds);
      const signed = await sessions.signSession(prepared, customerSigner(identity.wallet, identity.address, identity.epoch));
      await send("Spending session", DEPLOYMENT.vault, signed.transaction.data); ensureEpoch(identity.epoch);
      delegates.current.set(signed.sessionId, { signer }); setKeyRevision(value => value + 1);
      await refresh(); return signed.sessionId;
    }), [customerSigner, ensureEpoch, live, perform, refresh, requireAuth, send]);
  const manageSession = useCallback((id: Hex, action: "closeSession" | "revokeSessionSigner" | "refund") =>
    perform(action === "refund" ? "Refunding session" : action === "closeSession" ? "Closing session" : "Revoking signer", async () => {
      await send(action === "refund" ? "Session refund" : action === "closeSession" ? "Session closure" : "Signer revocation", DEPLOYMENT.vault,
        encodeFunctionData({ abi: emeterVaultAbi, functionName: action, args: [id] }));
      if (action !== "closeSession") { delegates.current.delete(id); setKeyRevision(value => value + 1); }
    }), [perform, send]);

  const getExecutor = useCallback(async (sessionId: Hex, current: Awaited<ReturnType<typeof live>>) => {
    const identity = requireAuth(), delegate = delegates.current.get(sessionId);
    if (!delegate) throw new Error("SESSION_KEY_UNAVAILABLE");
    const keys = KeysSchema.parse(await identity.client.getKeys()).keys; ensureEpoch(identity.epoch);
    const activeKey = keys.find(key => key.id === delegate.keyId && !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now()));
    if (!activeKey) {
      const key = await identity.client.createApiKey({ sessionId, scopes: ["execute", "request:read"] }); ensureEpoch(identity.epoch);
      delegate.keyId = key.id;
      if (delegate.client) delegate.client.setCredential(key.key);
      else delegate.client = new EmeterClient({ gatewayUrl: cfg.current!.gatewayUrl, token: key.key,
        fetch: async (input, init) => {
          ensureEpoch(identity.epoch);
          if (init?.method === "POST") {
            await assertWalletAnchor(identity.wallet, (await live()).network, identity.address); ensureEpoch(identity.epoch);
          }
          return fetch(input, init);
        },
        sessionId, sessionSigner: { signTypedData: async payload => {
          ensureEpoch(identity.epoch);
          const signature = await delegate.signer.signTypedData(payload); ensureEpoch(identity.epoch); return signature;
        } }, customerSigner: customerSigner(identity.wallet, identity.address, identity.epoch),
        rpcUrl: current.rpcUrl, vault: DEPLOYMENT.vault, registry: DEPLOYMENT.registry });
    }
    return delegate.client!;
  }, [customerSigner, ensureEpoch, live, requireAuth]);
  const runOperation = useCallback(async (retained: Operation) => {
    const identity = requireAuth(); const epoch = identity.epoch;
    setExecution({ requestId: retained.requestId, clientId: retained.clientId, sessionId: retained.sessionId, serviceId: retained.serviceId, phase: "authorizing" });
    let stopped = false;
    const poll = setInterval(() => {
      void retained.client.getRequest(retained.requestId).then(record => {
        if (!stopped && epoch === generation.current) setExecution({ requestId: retained.requestId, clientId: retained.clientId,
          sessionId: retained.sessionId, serviceId: retained.serviceId, phase: "running", record });
      }).catch(() => undefined);
    }, 1000);
    try {
      const record = await retained.client.execute({ serviceId: retained.serviceId, input: retained.input, maxCharge: retained.maxCharge,
        requestId: retained.clientId, priceVersion: retained.priceVersion,
        ...(retained.maximumTotalSpend !== undefined ? { overrideSoftLimit: true, maximumTotalSpend: retained.maximumTotalSpend } : {}), timeoutMs: 90_000 });
      stopped = true; clearInterval(poll);
      ensureEpoch(epoch);
      setExecution({ requestId: retained.requestId, clientId: retained.clientId, sessionId: retained.sessionId, serviceId: retained.serviceId,
        phase: record.requestStatus === "indeterminate" ? "unresolved" : "finished", record });
      await refresh();
    } catch (failure) {
      stopped = true; clearInterval(poll);
      if (epoch === generation.current) setExecution(previous => previous && ({ ...previous, phase: "unresolved", error: errorMessage(failure) }));
      throw failure;
    } finally { stopped = true; clearInterval(poll); }
  }, [ensureEpoch, refresh, requireAuth]);
  const execute = useCallback((input: RunInput) => perform("Executing request", async () => {
    if (operation.current) throw new Error("Inspect or recover the current request before starting another.");
    const identity = requireAuth(), current = await live(); await assertWalletAnchor(identity.wallet, current.network, identity.address);
    const freshAccount = AccountSchema.parse(await identity.client.getAccount());
    const session = freshAccount.sessions.find(value => value.sessionId === input.sessionId);
    if (!session) throw new Error("NOT_SESSION_CUSTOMER");
    const sessions = new EmeterSessionClient({ rpcUrl: current.rpcUrl, vault: DEPLOYMENT.vault, registry: DEPLOYMENT.registry });
    const quote = await sessions.getQuote(input.serviceId, input.priceVersion);
    const total = BigInt(session.spent) + BigInt(String(session.reservedBaseUnits ?? "0")) + quote.price;
    const maximum = exactDemo(input.maxCharge);
    if (maximum < quote.price || maximum > BigInt(session.maxCharge) || total > BigInt(session.budget)
      || BigInt(session.reservedBaseUnits) + quote.price > BigInt(session.balance)) throw new Error("REQUEST_BUDGET_EXCEEDED");
    if (!quote.active || !session.serviceIds.includes(input.serviceId) || session.signerRevoked || session.status !== 1
      || BigInt(current.network.anchor!.timestamp) >= BigInt(session.executionDeadline)) throw new Error("SESSION_UNAVAILABLE");
    if (input.maximumTotalSpend !== undefined && input.maximumTotalSpend !== total) throw new Error("OVERRIDE_CAP_MISMATCH");
    if (total > BigInt(session.softLimit) && input.maximumTotalSpend === undefined) throw new Error("SOFT_LIMIT_OVERRIDE_REQUIRED");
    const executor = await getExecutor(input.sessionId, current), clientId = crypto.randomUUID(); ensureEpoch(identity.epoch);
    const retained: Operation = { ...input, clientId, requestId: keccak256(toHex(clientId)), client: executor };
    operation.current = retained; await runOperation(retained);
  }), [ensureEpoch, getExecutor, live, perform, requireAuth, runOperation]);
  const recoverExecution = useCallback(() => perform("Recovering the same request", async () => {
    const retained = operation.current;
    if (!retained) throw new Error("UNKNOWN_REQUEST");
    await getExecutor(retained.sessionId, await live());
    try { await requireAuth().client.recoverRequest(retained.requestId); } catch (failure) {
      if (!(failure && typeof failure === "object" && "status" in failure && failure.status === 404)) throw failure;
    }
    await runOperation(retained);
  }), [getExecutor, live, perform, requireAuth, runOperation]);
  const clearExecution = useCallback(() => {
    if (working.current || execution?.phase !== "finished") return;
    operation.current = undefined; setExecution(undefined);
  }, [execution]);
  const verifyRequest = useCallback(async (id: Hex) => {
    const identity = requireAuth(); await live();
    ensureEpoch(identity.epoch);
    const verified = await identity.client.verifyRequest(id); ensureEpoch(identity.epoch); return verified;
  }, [ensureEpoch, live, requireAuth]);
  const recoverRequest = useCallback((id: Hex) => perform("Recovering request", async () => {
    await requireAuth().client.recoverRequest(id); await refresh();
  }), [perform, refresh, requireAuth]);
  const approveSettlement = useCallback((id: Hex, maximumTotalSpend: bigint) => perform("Approving this settlement", async () => {
    const identity = requireAuth(), current = await live();
    const record = await identity.client.getRequest(id);
    const { fromWireCharge } = await import("@emeter/shared");
    const charge = fromWireCharge(record.authorization);
    const sessions = new EmeterSessionClient({ rpcUrl: current.rpcUrl, vault: DEPLOYMENT.vault, registry: DEPLOYMENT.registry });
    const state = await sessions.getSession(record.sessionId);
    const exact = state.spent + BigInt(record.priceBaseUnits);
    if (maximumTotalSpend !== exact) throw new Error("OVERRIDE_CAP_MISMATCH");
    const signed = await sessions.signOverride(charge, maximumTotalSpend, state.refundAfter,
      customerSigner(identity.wallet, identity.address, identity.epoch));
    await identity.client.requestSettlement(id, { ...signed.authorization, signature: signed.signature }); await refresh();
  }), [customerSigner, live, perform, refresh, requireAuth]);
  const getKeys = useCallback(async () => {
    const identity = requireAuth(), result = KeysSchema.parse(await identity.client.getKeys()).keys;
    ensureEpoch(identity.epoch); return result;
  }, [ensureEpoch, requireAuth]);
  const createKey = useCallback((input: Parameters<EmeterClient["createApiKey"]>[0]) => perform("Creating scoped credential", async () => {
    const value = await requireAuth().client.createApiKey(input); return { id: value.id, key: value.key };
  }), [perform, requireAuth]);
  const revokeKey = useCallback((id: string) => perform("Revoking credential", async () => { await requireAuth().client.revokeApiKey(id); }), [perform, requireAuth]);
  const getUsage = useCallback(async () => {
    const identity = requireAuth(), result = UsageSchema.parse(await identity.client.getUsage());
    ensureEpoch(identity.epoch); return result;
  }, [ensureEpoch, requireAuth]);
  const registerService = useCallback((raw: ServiceManifest) => perform("Verifying service endpoint", async () => {
    const manifest = ServiceManifestSchema.parse(raw), identity = requireAuth();
    const responseSchema = z.object({ status: z.enum(["registered", "awaiting_chain_registration"]),
      transaction: z.object({ to: AddressSchema, data: z.string().regex(/^0x[0-9a-f]+$/i) }).optional() }).passthrough();
    const prepared = responseSchema.parse(await identity.client.registerService(manifest));
    if (prepared.status === "awaiting_chain_registration") {
      const { manifestHash } = await import("@emeter/shared");
      const expected = encodeFunctionData({ abi: emeterRegistryAbi, functionName: "registerService", args: [manifest.serviceId,
        manifest.payout, manifest.signer, manifest.container, BigInt(manifest.priceBaseUnits), manifestHash(manifest)] });
      if (prepared.transaction?.to.toLowerCase() !== DEPLOYMENT.registry.toLowerCase() || prepared.transaction.data.toLowerCase() !== expected.toLowerCase())
        throw new Error("DEPLOYMENT_MISMATCH");
      await send("Service registration", DEPLOYMENT.registry, expected); ensureEpoch(identity.epoch);
      if (responseSchema.parse(await identity.client.registerService(manifest)).status !== "registered") throw new Error("ENDPOINT_VERIFICATION_FAILED");
    }
    setNotice("Endpoint signature and onchain service terms verified."); await refresh();
  }), [ensureEpoch, perform, refresh, requireAuth, send]);
  const checkPending = useCallback((value?: string) => perform("Checking pending transaction", async () => {
    const retained = transaction.current;
    if (!retained) return;
    const hash = value ? HashSchema.parse(value) : retained.hash;
    if (!hash) throw new Error("UNKNOWN_BROADCAST");
    setPending({ ...retained, hash }); await confirmTransaction(retained, hash);
  }), [confirmTransaction, perform, setPending]);
  const value: GatewayValue = useMemo(() => ({ config, network, services, account, address, signedIn, reachable, busy, error, notice,
    loading, refreshedAt, pending, execution, refresh, connect, disconnect, clearError: () => setError(undefined),
    deposit, withdraw, createSession, manageSession, hasSessionKey: id => delegates.current.has(id), execute, recoverExecution, clearExecution,
    verifyRequest, recoverRequest, approveSettlement, getKeys, createKey, revokeKey, getUsage, registerService, checkPending }),
  [config, network, services, account, address, signedIn, reachable, keyRevision, busy, error, notice, loading, refreshedAt, pending, execution,
    refresh, connect, disconnect, deposit, withdraw, createSession, manageSession, execute, recoverExecution, clearExecution,
    verifyRequest, recoverRequest, approveSettlement, getKeys, createKey, revokeKey, getUsage, registerService, checkPending]);
  return <Gateway.Provider value={value}>{children}</Gateway.Provider>;
}
export function useGateway() {
  const value = useContext(Gateway);
  if (!value) throw new Error("GatewayProvider is required");
  return value;
}
