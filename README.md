# emeter

Programmable payments for AI agents and APIs.

emeter uses **existing USDC on X Layer**. Fund credit with USDC withdrawn or bridged onto X Layer; your wallet also needs OKB for gas. The deposit form explains how to obtain the exact supported token. The [USDC migration](docs/usdc.md) records the deployed vault, funding guidance, and verification.

Open the [public workspace](https://emeter-peach.vercel.app), inspect the [gateway status](https://first-eel-292.convex.site/api/protocol), or browse the [source](https://github.com/greyw0rks/emeter). The selected light workspace uses a sidebar on desktop and an accessible icon rail on phones.

emeter is being built for X Layer TapeOut Accelerate. A published TapeOut NAND circuit authorizes or denies USDC settlements on X Layer mainnet. Registered services, immutable price versions, prepaid customer credit, and capped signing sessions govern actual AI analysis and JSON validation. Vercel hosts the interface; Convex hosts the gateway, durable records, and execution/settlement jobs.

The [USDC vault deployment](deployments/xlayer-196-usdc.json) is independently verified by two RPCs and reused the existing registry and policy adapter. The complete browser flow passed 18 checks using actual USDC on a disposable local fork, including deposits, payments, customer overrides, and refunds. The deployment itself transferred no USDC. The [original circuit proof](docs/verification.md), [payment-engine proof](docs/payment-engine.md), and [hosted gateway proof](docs/evidence/gateway-mainnet-verification.json) remain historical DEMO demonstrations: **0.09 DEMO paid** and **0.01 DEMO refunded** in the hosted proof. DEMO has no monetary value. One actual Otari response reported 88 input / 58 output tokens and **$0.00001820** cost; the public AI runtime retains its **$0.01 total estimated/reported cost cap**. These builder-controlled proofs do not establish independent adoption or real USDC revenue.

The [frontend workspace](docs/frontend.md) connects wallet credit, bounded sessions, provider credentials, execution, independent receipts, and the live policy circuit. Eighteen browser checks exercise the complete customer/provider flow on a disposable historical fork. Earlier fork/AI artifacts remain separately labeled in [gateway.md](docs/gateway.md).

## Workspace

- `apps/web`: Next.js/React workspace, wallet flows, playground, receipts, provider credentials, and R3F/SVG policy visualization.
- `apps/gateway`: Authenticated Fastify gateway, signed providers, execution/settlement workers, and chain indexer.
- `convex`: Hosted HTTP/Node actions, atomic record adapter, fenced leases, durable scheduler jobs, and AI spending ledger.
- `packages/database`: PostgreSQL/Prisma records and additive migrations.
- `packages/contracts`: Service registry, session vault, circuit adapter, original proof vault, and Foundry tests.
- `packages/circuit`: TAP-02 NAND compiler, simulator, and exhaustive policy vectors.
- `packages/shared`: Shared policy, receipt, and network types.
- `packages/sdk`: Wallet authentication, scoped credentials, bounded signing, HTTP execution, and independent receipt/payment verification.
- `scripts/verify`: Live X Layer checks and local proof capture.
- `scripts/deploy`: Deployment preparation and receipt verification.

## Setup

Node.js 22.12 or newer, pnpm 12.16.1, and Foundry are required.

```sh
pnpm install
pnpm db:generate
pnpm contracts:install
pnpm circuit:generate
pnpm test
pnpm typecheck
pnpm build
pnpm verify:xlayer
X_LAYER_RPC_URL=https://rpc.xlayer.tech pnpm test:fork
pnpm proof:local
pnpm verify:deployment
X_LAYER_RPC_URL=https://rpc.xlayer.tech pnpm test:engine:fork
pnpm proof:engine:local
pnpm verify:engine
pnpm verify:gateway
pnpm proof:gateway
```

Use `.env.example` for public configuration. Keep private keys out of this repository and out of chat. A dedicated wallet or encrypted Foundry account funded with OKB is needed for a mainnet broadcast. USDC payments use the existing supported token; emeter does not mint it.

For the web workspace, configure `apps/web/.env.local` from `.env.web.example`, matching the running gateway and exact fork RPC. Start it with `rtk pnpm dev:web`. [Frontend setup and verification](docs/frontend.md) explains browser origins, wallet block-hash checks, tab-only keys, and transaction/request recovery.

The original mainnet proof is recorded in `deployments/xlayer-196.json`; the payment-engine journal is `deployments/xlayer-196-engine.json`; hosted activation is `deployments/xlayer-196-gateway.json`. `pnpm verify:deployment`, `pnpm verify:engine`, and `pnpm verify:gateway` verify those historical proofs against live RPCs without signing transactions or spending funds. Gateway verification uses the published signed request records by default; `--refresh` additionally requires the authorized external operator signer to authenticate and reload its owned records. Neither mode calls AI. Deployment scripts preserve existing journals and exact signed transaction bytes.

[Hosted setup](docs/hosting.md) covers Convex configuration, Vercel production settings, exact browser origins, and readiness. PostgreSQL/Prisma and Redis/BullMQ remain the local reference runtime and support reproducible fork checks.

## Policy

`ALLOW = A ∧ B ∧ C ∧ D ∧ (E ∨ F)`

The vault derives authorization, receipt, session, and limit inputs from verified evidence and contract state. The circuit verdict is enforced before token transfer. A signed provider response attributes what the provider reported; it does not prove AI correctness or customer acceptance.

Only successful onchain receipts count as settled payments. Local tests, fork activity, and mainnet activity are documented separately.

The proofs use builder-controlled wallets. Mainnet gateway activation is complete. Frontend fork checks use actual JSON/schema validation and a labeled offline AI fixture; public browser smoke checks make no wallet signatures, transactions, or paid AI calls. Independent testing, a recorded app demo, and event submission remain next; the [submission draft](docs/submission.md) and [recording outline](docs/demo-script.md) are prepared. [Architecture](docs/architecture.md), [protocol review](docs/protocol-review.md), [threat model](docs/threat-model.md), and [roadmap](docs/roadmap.md) describe the boundaries.
