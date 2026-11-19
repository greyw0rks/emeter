# MVP roadmap

emeter: programmable payments for AI agents and APIs. Meter every request. Control every payment.

The accepted MVP supports one network (X Layer), one zero-value demo token, prepaid per-request billing, one policy, and two functioning services. The initial milestone implements the user's first Codex task: publish the policy and prove circuit-gated settlement before the full UI.

| Milestone | Status | Result |
| --- | --- | --- |
| Protocol proof | Complete | pnpm workspace, exact NAND policy, exhaustive vectors, two-RPC verification, fail-closed adapter, real isolated payment/refund proof. |
| Payment engine | Complete | Service registry, customer sessions, EIP-712 delegated signing keys, immutable price versions, spending caps, replay protection, refunds, SDK signing helpers, and an independently verified eighteen-transaction mainnet proof. |
| Gateway and SDK | Next | Developer authentication/API credentials, actual AI Text Analyzer and JSON Validator, signed responses, settlement worker, chain indexer, PostgreSQL/Prisma records, usable HTTP execute client. |
| Product interface | Pending | Landing, registration/dashboard, playground, receipt inspector, policy explorer, wallet/network flow, circuit visualization driven by real lifecycle events. |
| Submission | Pending | Verified addresses, public source/application links, external testing, concise commercial model, actual three-minute demo, event submission. |

The approved visual direction remains Electric precision: Void/Graphite surfaces, Electric Mint actions, Signal Lime accents, Geist Sans/Mono, restrained Motion transitions, and React Three Fiber circuit scenes with reduced-motion/mobile fallbacks.

The pricing hypothesis is a 1–2% fee on successfully settled API payments, with provider analytics plans later. No platform fee, subscription, commercial revenue, paid AI endpoint, or independent user adoption is claimed by the protocol proof. High-frequency batching/channels, recurring subscriptions, fiat, cross-chain billing, and disputes remain after the MVP.

Submission target: 7 December 2026 at 23:59 UTC, subject to the event's official schedule. Circuit submissions must include processor address and circuit ID; applications must provide access links and explain meaningful TapeOut integration.
