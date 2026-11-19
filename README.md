# emeter

Programmable payments for AI agents and APIs.

emeter is being built for X Layer TapeOut Accelerate. The first milestone is complete: a published TapeOut NAND circuit authorizes or denies real DemoUSD settlements on X Layer mainnet. The developer dashboard and paid-service journey follow this protocol foundation.

The [verified proof and contract addresses](docs/verification.md) include an allowed payment, a reverted soft-limit charge, a signed override, and an unused-balance refund. Both independent RPCs agree on the recorded transactions and all 64 circuit inputs. The billing gateway and full product UI are the next milestones.

## Workspace

- `apps/web`: Next.js scaffold; full UI deferred until the protocol proof.
- `apps/gateway`: Fastify gateway scaffold.
- `packages/contracts`: Solidity adapter, isolated demo payment vault, and Foundry tests.
- `packages/circuit`: TAP-02 NAND compiler, simulator, and exhaustive policy vectors.
- `packages/shared`: Shared policy, receipt, and network types.
- `packages/sdk`: TypeScript client scaffold.
- `scripts/verify`: Live X Layer checks and local proof capture.
- `scripts/deploy`: Deployment preparation and receipt verification.

## Setup

Node.js 22.12 or newer, pnpm 12.16.1, and Foundry are required.

```sh
pnpm install
pnpm contracts:install
pnpm circuit:generate
pnpm test
pnpm typecheck
pnpm build
pnpm verify:xlayer
X_LAYER_RPC_URL=https://rpc.xlayer.tech pnpm test:fork
pnpm proof:local
pnpm verify:deployment
```

Use `.env.example` for public configuration. Keep private keys out of this repository and out of chat. A dedicated wallet or encrypted Foundry account funded with OKB is needed for a mainnet broadcast; DemoUSD itself has no monetary value.

The existing mainnet proof is recorded in `deployments/xlayer-196.json`. `pnpm verify:deployment` reads and verifies it without signing or spending funds. Deployment scripts refuse to silently replace an existing mainnet journal.

## Policy

`ALLOW = A ∧ B ∧ C ∧ D ∧ (E ∨ F)`

The vault derives authorization, receipt, session, and limit inputs from verified evidence and contract state. The circuit verdict is enforced before token transfer. A signed provider response attributes what the provider reported; it does not prove AI correctness or customer acceptance.

Only successful onchain receipts count as settled payments. Local tests, fork activity, and mainnet activity are documented separately.

The proof uses one builder-controlled customer/provider pair and a local schema-validation operation. Service registration, delegated sessions, paid HTTP APIs, the AI utility, indexing, and the complete UI are still to be built. [Architecture](docs/architecture.md), [protocol review](docs/protocol-review.md), [threat model](docs/threat-model.md), and [roadmap](docs/roadmap.md) describe the boundaries.
