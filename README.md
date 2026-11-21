# emeter

Programmable payments for AI agents and APIs.

emeter is being built for X Layer TapeOut Accelerate. A published TapeOut NAND circuit authorizes or denies real DemoUSD settlements on X Layer mainnet. The payment engine adds registered services, immutable price versions, prepaid customer credit, and capped delegated signing sessions. The paid gateway connects these controls to AI text analysis and JSON validation through a verified HTTP SDK.

The [original circuit proof](docs/verification.md) and [completed payment-engine proof](docs/payment-engine.md) include real payments, rejected overrides, and unused-balance refunds. Both independent RPCs agree on the recorded transactions. The [gateway checkpoint](docs/gateway.md) adds a real Otari response and thirty-two checks of authenticated execution, settlement, and recovery on a local X Layer fork. The [frontend workspace](docs/frontend.md) connects wallet credit, scoped sessions, provider registration, execution, receipt inspection, and the live policy circuit; eighteen browser checks exercise the complete customer/provider flow on a disposable fork.

## Workspace

- `apps/web`: Next.js/React workspace, wallet flows, playground, receipts, provider credentials, and R3F/SVG policy visualization.
- `apps/gateway`: Authenticated Fastify gateway, signed providers, execution/settlement workers, and chain indexer.
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
pnpm proof:gateway
```

Use `.env.example` for public configuration. Keep private keys out of this repository and out of chat. A dedicated wallet or encrypted Foundry account funded with OKB is needed for a mainnet broadcast; DemoUSD itself has no monetary value.

For the web workspace, configure `apps/web/.env.local` from `.env.web.example`, matching the running gateway and exact fork RPC. Start it with `rtk pnpm dev:web`. [Frontend setup and verification](docs/frontend.md) explains browser origins, wallet block-hash checks, tab-only keys, and transaction/request recovery.

The original mainnet proof is recorded in `deployments/xlayer-196.json`; the completed payment-engine journal is `deployments/xlayer-196-engine.json`. `pnpm verify:deployment` verifies the original historical proof without signing or spending funds. `pnpm verify:engine` checks the engine's transaction inputs, scoped sessions, versioned prices, denial, refunds, and token accounting against two independent RPCs. Deployment scripts refuse to silently replace an existing mainnet journal.

## Policy

`ALLOW = A ∧ B ∧ C ∧ D ∧ (E ∨ F)`

The vault derives authorization, receipt, session, and limit inputs from verified evidence and contract state. The circuit verdict is enforced before token transfer. A signed provider response attributes what the provider reported; it does not prove AI correctness or customer acceptance.

Only successful onchain receipts count as settled payments. Local tests, fork activity, and mainnet activity are documented separately.

The proofs use builder-controlled wallets. The gateway checkpoint combines functioning JSON validation, one actual AI response, authenticated HTTP requests, durable indexing, and verified local-fork payments. The frontend proof uses actual JSON/schema validation and a labeled offline AI fixture, with no new paid AI call or mainnet broadcast. Public mainnet gateway activation, public access/source, independent testing, and submission remain next. [Architecture](docs/architecture.md), [protocol review](docs/protocol-review.md), [threat model](docs/threat-model.md), and [roadmap](docs/roadmap.md) describe the boundaries.
