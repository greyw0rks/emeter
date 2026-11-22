# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and AI agent operators who need per-request API billing with bounded spending. Providers register services and inspect usage; customers fund credit, authorize scoped sessions, execute services, and inspect receipts.

## Product Purpose

emeter makes programmable payments for AI agents and APIs: meter every request and control every payment. Customers sign hard budgets, per-request maxima, service scopes, expiry, and soft limits. A real TapeOut circuit on X Layer permits or denies settlement from authenticated evidence.

## Positioning

The onchain policy enforces `A ∧ B ∧ C ∧ D ∧ (E ∨ F)`. A separate customer signature is required to cross a soft limit. Request completion, provider-reported delivery, receipt verification, and actual payment are different states.

## Operating Context

One X Layer network (chain 196), one zero-value six-decimal DemoUSD token, prepaid credit, and two implemented services: JSON Validator and AI Text Analyzer through Otari. Next.js 16 / React 19 runs on Vercel; the hosted gateway uses Convex HTTP/Node actions, durable records, and scheduled jobs while reusing the Fastify protocol handlers. PostgreSQL/Prisma and BullMQ remain the local reference runtime. Browser wallets sign customer grants and transactions; delegated signing keys stay client-side. The workspace uses horizontal top navigation on desktop and phones, with no sidebar.

## Capabilities and Constraints

Service registration, immutable price versions, session grants, delegated charges, customer overrides, refunds, wallet authentication, scoped API credentials, signed responses, canonical indexing, and independent SDK receipt/payment verification are implemented. Unknown completions retain reservations until recovery or expiry. Closed sessions preserve their original refund window.

Mainnet circuit, payment-engine, and hosted HTTP gateway proofs are complete. Two independent RPCs verify three hosted requests, including one actual Otari call, 0.09 DEMO paid, and 0.01 DEMO refunded directly to the customer. The public AI runtime has a $0.01 total estimated/reported cost cap. Independent adoption and submission remain pending. The frontend must show real backend records, useful empty/offline states, and an explicit local-fork label when applicable. Provider signatures do not prove AI correctness or customer acceptance. Proposed platform fees are a hypothesis, not implemented revenue.

## Brand Commitments

The accepted name is emeter. The accepted direction is Electric precision: Void/Graphite surfaces, Electric Mint actions, Signal Lime accents, Geist Sans/Mono, restrained Motion transitions, and React Three Fiber circuit scenes with reduced-motion and mobile fallbacks. Preserve these commitments from `docs/roadmap.md`.

## Evidence on Hand

`deployments/xlayer-196.json`, `deployments/xlayer-196-engine.json`, and `deployments/xlayer-196-gateway.json` establish the completed checkpoints. `docs/evidence/gateway-mainnet-verification.json` records matching RPC evidence, original signed requests, exact token/gas accounting, and the recomputed $0.00001820 reported AI cost. Earlier fork artifacts remain separately labeled. Builder-controlled proof wallets are not independent users. Do not invent customers, testimonials, revenue, or service availability beyond current readiness.

## Product Principles

- Consent names a budget, scope, and deadline.
- A result and a payment have separate evidence.
- Retrying a request preserves its identity and authorization.
- Monetary values remain exact integer token units.
- User-facing status comes from current records and confirmed chain state.

## Accessibility & Inclusion

Keyboard access, visible focus, clear form labels, responsive mobile layouts, reduced motion, and a usable non-WebGL circuit view are required for this frontend milestone.
