# MVP roadmap

emeter: programmable payments for AI agents and APIs. Meter every request. Control every payment.

The accepted MVP supports one network (X Layer), existing USDC, prepaid per-request billing, one policy, and two functioning services. The initial milestone implements the user's first Codex task: publish the policy and prove circuit-gated settlement before the full UI.

| Milestone | Status | Result |
| --- | --- | --- |
| Protocol proof | Complete | pnpm workspace, exact NAND policy, exhaustive vectors, two-RPC verification, fail-closed adapter, real isolated payment/refund proof. |
| Payment engine | Complete | Service registry, customer sessions, EIP-712 delegated signing keys, immutable price versions, spending caps, replay protection, refunds, SDK signing helpers, and an independently verified eighteen-transaction mainnet proof. |
| Gateway and SDK | Hosted and verified on mainnet | Convex HTTP/Node actions, atomic records and fenced leases, durable scheduler jobs, wallet authentication/scoped keys, signed JSON/AI results, original transaction reuse and canonical indexing; three independently verified mainnet payments, 0.09 DEMO paid and 0.01 DEMO refunded. One real AI response reports $0.00001820 under the $0.01 cap. PostgreSQL/BullMQ remain the local reference. |
| Product interface | Implemented and verified on a local fork | Full-width top navigation, wallet credit/session flows, provider tools, playground, independent receipts and R3F/SVG policy; 290 local tests including 17 Convex checks, production build/typecheck, 18 complete browser checks and 19 desktop/mobile captures. Public hosting uses Vercel and the production Convex gateway. |
| Public launch | Implemented | Production gateway and frontend links, verified deployment records, public source, anonymous access/CORS/route verification, responsive navigation, and published mainnet evidence. |
| Submission | Draft prepared | [Project/commercial description and access guide](submission.md), [three-minute recording outline](demo-script.md); independent external testing, actual recorded video, and authorized event submission remain. |

On 22 November 2026 the user selected the light sidebar concept: periwinkle surround, white rounded frame, violet actions, pastel functional surfaces, and a left sidebar that becomes an accessible icon rail on phones. This replaces the earlier dark/no-sidebar direction. Geist Sans/Mono, state-driven Motion, and the actual R3F/SVG policy circuit remain.

The pricing hypothesis is a 1–2% fee on successfully settled API payments, with provider analytics plans later. No platform fee, subscription, commercial revenue, paid AI endpoint, or independent user adoption is claimed by the protocol proof. High-frequency batching/channels, recurring subscriptions, fiat, cross-chain billing, and disputes remain after the MVP.

Submission target: 7 December 2026 at 23:59 UTC, subject to the event's official schedule. Circuit submissions must include processor address and circuit ID; applications must provide access links and explain meaningful TapeOut integration.
