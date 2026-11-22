# Paid gateway and SDK

The third emeter milestone connects the existing X Layer registry and vault to authenticated HTTP requests, functioning JSON validation and AI text analysis, durable reservations, signed receipts, settlement jobs, and chain indexing. The complete gateway lifecycle passes thirty-two checks against a local fork of the real deployed engine and TapeOut processor. The existing mainnet contract journals remain the deployment authority.

The production HTTP gateway is **https://first-eel-292.convex.site**. Its AI Text Analyzer and JSON Validator are registered on X Layer mainnet. The **21 November 2026** activation completed three requests, paid **0.09 DEMO**, closed/revoked the bounded session, and refunded **0.01 DEMO directly to the customer wallet**. The actual Otari response reported **88 input / 58 output tokens**, with independently recomputed reported model cost **$0.00001820**. Both RPCs agree on the signed request bindings, all transactions, original refund timing, and token/gas accounting. See [gateway-mainnet-verification.json](evidence/gateway-mainnet-verification.json), [original signed request evidence](evidence/gateway-mainnet-requests.json), and [activation record](../deployments/xlayer-196-gateway.json). These are builder-controlled proofs, with no independent adoption claimed.

## Hosted Convex runtime

Convex hosts HTTP/Node actions, durable records, and scheduled execution/settlement jobs while reusing the existing Fastify handlers and SDK. The local PostgreSQL/Prisma/BullMQ implementation below remains the reference runtime. The hosted adapter commits buffered changes atomically, checks table epochs across paginated reads, and fences leases across external RPC reads and signing. Scheduled jobs retain deduplication, concurrency limits, retries, stale-job recovery, and original transaction evidence.

Credentials are hashed before crossing into Node action arguments. Newly issued credentials are generated at the HTTP boundary and returned once. Dedicated provider/relayer keys and the Otari credential are stored as Convex environment secrets; the existing operator signer is never uploaded. Exact browser/provider origins are allowlisted.

The public AI ledger caps total estimated/reported upstream spending at **$0.01**, protects request IDs against replay, and retains unknown costs. This is independent of each customer's DEMO budget and the **0.001 OKB** configured relayer gas ceiling. The activation's operator outflow was **0.001023797752 OKB**, including **0.001 OKB** relayer funding; relayer settlement gas was **0.000019302118 OKB**.

Both public RPCs limit log queries to 100 blocks. Hosted maintenance processes at most four such batches per invocation, runs every 60 seconds when idle, and runs sooner for pending activity. Fresh cursor/heartbeat checks use a 75-second window. Paid request dispatch and relayer broadcasts also require the cursor's exact block hash to remain canonical. Internal rebuild pauses execution and refuses to run while workers are active.

Public deployment references and operational instructions are in [hosting.md](hosting.md). Deployment preparation is read-only; activation is a separately authorized, capped operation whose external journal saves exact signed transactions before any broadcast. Its resume path reuses confirmed steps and signed request payloads.

## Request lifecycle

Customers authenticate by signing a five-minute, single-use challenge bound to the gateway origin, wallet, and chain 196. Wallet login can issue a credential scoped to an owned spending session. The credential expires at that session's refund deadline; the delegated signing key separately authorizes each request. Provider credentials grant usage and receipt access for one registered service. Credential values are returned once and stored only as hashes.

`EmeterClient.execute` reads the registry's immutable price version and checks its manifest hash before signing a capped EIP-712 charge. The gateway checks the customer, delegated signature, request hash, service scope, nonce, time limits, and exact base-unit price. A PostgreSQL transaction takes a session lock, rereads chain state, and reserves the price against remaining credit and the customer's soft limit.

The provider persists the request id before contacting the AI source or running JSON validation. Repeated calls retrieve its stored response. A process interrupted before persisting its result reports an unknown completion and retains the reservation. Explicit recovery resends the original request and nonce; an unknown upstream operation is never silently executed again. Reservations expire only after the contract can no longer accept their settlement.

Verified positive responses queue a settlement. The relayer previews the real TapeOut circuit and simulates the vault call, then saves the signed transaction and its exact nonce and hash in PostgreSQL before broadcasting. Retry reuses that transaction. Only the indexer, after verifying the matching `ChargeSettled` event and receipt digest in a canonical confirmed block, marks the request settled. A circuit denial preserves the signed output for a separate customer override or eventual expiry.

The SDK independently checks the stored charge, provider receipt, result body, immutable service manifest, transaction calldata, successful mined receipt, canonical block, confirmation depth, and settlement event. `receiptVerified` and `settlementVerified` are separate results. A timeout error retains its request id for recovery; calling `execute` again with the same id retrieves the same authorization rather than choosing another nonce.

## Services and receipts

The JSON Validator accepts strict JSON and an optional bounded JSON Schema. Unsupported regex and reference features fail with a signed error. A result saying the supplied JSON is invalid is a successful validation computation and can settle; an execution error cannot settle.

The AI Text Analyzer uses the official Anthropic SDK with Otari's Anthropic-compatible API. Its selected model is checked against the live catalogue. Responses must complete and contain a valid summary, sentiment, and topics object. Captured request and response body bytes, SHA-256 hashes, normalized token counts, model matching, and integer weighted cost calculations accompany its signed usage receipt. Headers and upstream credentials are not retained.

The supported usage evidence follows the non-streaming Anthropic Messages receipt shape and arithmetic in TAP-17. It travels inside the paid TAP-13 result and is available through the provider's authenticated `receipt` method. This gateway is not a transparent TAP-17 streaming sidecar. These signatures attribute provider-reported usage and delivery; they do not establish upstream authenticity, AI correctness, or customer acceptance. Reported USD model cost is separate from the fixed per-request DEMO payment.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/protocol` | Read engine identities, mode, confirmation depth, and current readiness. |
| `POST /api/auth/challenge`, `POST /api/auth/verify` | Authenticate a wallet with replay protection. |
| `POST /api/auth/logout` | Revoke the current credential. |
| `POST /api/keys`, `GET /api/keys`, `DELETE /api/keys/:id` | Create, inspect metadata for, and revoke scoped credentials. |
| `GET /api/services`, `POST /api/services` | Read verified services or prepare and confirm an owner's onchain registration. |
| `GET /api/services/:id/quote`, `GET /api/services/:id/manifest` | Read a selected immutable version. |
| `POST /api/sessions`, `POST /api/sessions/:id/authorize` | Prepare a bounded customer grant and wallet transaction. |
| `GET /api/sessions/:id` | Read an owned session from the vault. |
| `POST /api/execute/:serviceId` | Reserve and enqueue a signed request. |
| `GET /api/requests/:id`, `GET /api/receipts/:id` | Inspect an authorized request, result, receipt, and payment status. |
| `POST /api/requests/:id/recover` | Retrieve an uncertain completion using the original signed request. |
| `POST /api/settlements` | Retry retained evidence, optionally with a separate customer override. |
| `GET /api/dashboard/usage` | Read scoped provider activity and confirmed payment totals. |

All amounts in wire authorizations and database records are decimal strings in six-decimal token base units. The SDK's `maxCharge` accepts an exact DEMO decimal with at most six fraction digits. Request status and payment status remain separate; `indeterminate`, `denied`, and `pending` never count as settled.

```ts
import { EmeterClient } from "@emeter/sdk";

// Supply these values from your wallet, authorized session, and external
// credential storage. The customer key and delegated key stay client-side.
const emeter = new EmeterClient({
  gatewayUrl, rpcUrl, vault, registry,
  sessionId, sessionSigner, customerSigner, token: sessionApiKey,
});
const result = await emeter.execute({
  serviceId: "json-validator",
  input: { json: '{"name":"emeter"}' },
  maxCharge: "0.05",
  requestId: crypto.randomUUID(),
});
if (result.receiptVerified && result.settlementVerified) {
  // Both the returned computation and its onchain payment were verified.
}
```

## Runtime setup

Use Node 22.12+, pnpm, PostgreSQL, Redis, and the already deployed engine. Copy [.env.gateway.example](../.env.gateway.example) to an external credential file. Set a random dispatch secret of at least 32 characters, the explicitly authorized external signer source, and an external Otari environment file containing `OTARI_API_KEY`. Keep populated configuration outside this repository.

```sh
pnpm install
pnpm --filter @emeter/database generate
EMETER_RUNTIME_ENV=/path/to/external/gateway.env pnpm --filter @emeter/database migrate
EMETER_RUNTIME_ENV=/path/to/external/gateway.env pnpm --filter @emeter/gateway providers
EMETER_RUNTIME_ENV=/path/to/external/gateway.env pnpm dev:gateway
EMETER_RUNTIME_ENV=/path/to/external/gateway.env pnpm --filter @emeter/gateway worker
```

Run the last three commands as separate processes. Provider registration prepares wallet calldata and confirms its actual onchain terms; starting the servers does not register services, fund customers, or authorize spending. Public provider origins require HTTPS and an explicit origin allowlist. Use a database and queue prefix dedicated to this engine. The runtime's relayer gas ceiling is independent of the customer's DEMO budget.

Readiness requires a recent worker heartbeat and verified indexer cursor, usable queue and database, a verified active service, the correct vault/registry/token/adapter identities, and actual allow/deny results from the adapter. An unavailable dependency or detected reorg stops readiness. Stop workers before calling `rebuildIndexer`; it rebuilds indexed projections while retaining signed request, provider, and transaction evidence. An orphaned transaction is retried using its original bytes rather than silently signing a replacement.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm proof:gateway
# Optional: one explicitly authorized Otari request, with a $0.01 test ceiling.
pnpm proof:gateway --live-ai
```

`proof:gateway` creates an isolated X Layer Anvil fork, temporary in-memory wallets, a disposable PostgreSQL database, and uniquely prefixed Redis queues. It reuses the existing mainnet contract addresses and bytecode, makes no mainnet broadcasts, and removes its test resources. Set `EMETER_TEST_POSTGRES_URL`, `EMETER_TEST_REDIS_URL`, or `EMETER_TEST_FORK_RPC` when the default local services or fork source differ. Ordinary proof runs use explicitly labeled AI fixtures; `--live-ai` performs one real upstream call with SDK retries disabled.

The run covers authentication replay, credential scope and revocation, actual JSON computation and payment, client-side tampering rejection, duplicate requests, concurrent reservations, immutable price versions, provider restarts, post-execution persistence failures, circuit denial and customer-only override, uncertain completions, expiry, refunds, and reorg recovery. A successful run writes [gateway-fork-checks.json](evidence/gateway-fork-checks.json) with source hashes and separate fixture/live AI counts. A successful live run also retains [gateway-live-ai-checks.json](evidence/gateway-live-ai-checks.json).

The **20 November 2026** checkpoint passes **245 workspace tests**, typechecking, the production build, and **32 integration checks**. Its one real Otari request used `mistralai/mistral-small-3.2-24b`, returned a useful summary, neutral sentiment, and five topics, and reported **84 input / 66 output tokens**. The independently recomputed model cost was **$0.00001950**; its **0.05 DEMO** payment settled only on the local fork. Fourteen gateway requests included eleven confirmed payments; expired unknown completions ended with no remaining unknown reservations. Customer refunds and exact token conservation passed. All recorded runtime source hashes match this checkpoint.

The hosted gateway and light workspace are implemented, and mainnet activation is complete. Independent tester adoption and event submission remain later work. The earlier local-fork checkpoint remains historical evidence; it does not substitute for the new mainnet verification.
