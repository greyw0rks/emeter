# X Layer TapeOut Accelerate submission draft

Prepared on 22 November 2026. This is a draft; no event submission or independent user testing is recorded. The supplied deadline is 7 December 2026 at 23:59 UTC, subject to the official event schedule.

## Project

**emeter — programmable payments for AI agents and APIs.**

AI and API developers need to publish prices, authorize usage, track requests, and collect payments. Their customers need enforceable spending limits and a way to inspect what was delivered and paid. emeter combines prepaid credit, immutable service prices, bounded signing sessions, signed responses, and circuit-enforced settlement.

Customers connect a wallet, fund credit, and authorize a session with a budget, per-request maximum, service scope, and expiry. They run JSON validation or AI text analysis, then inspect the provider's signed output and independently verified payment. A customer must approve any soft-limit exception; hard budgets remain enforced.

## Access

| Item | Link |
| --- | --- |
| Application | https://emeter-peach.vercel.app |
| Gateway status | https://first-eel-292.convex.site/api/protocol |
| Public source | https://github.com/greyw0rks/emeter |
| Verification evidence | [gateway-mainnet-verification.json](evidence/gateway-mainnet-verification.json) |
| Recording outline | [demo-script.md](demo-script.md) |

The interface and service catalog are publicly accessible. Account records require an origin-bound wallet login. Spending requires a separate session authorization and customer-owned DEMO credit; the current demo token's minting is restricted. Wallet gas is paid in OKB. Public access alone does not establish that a new tester has funding or permission to register a provider.

## Meaningful TapeOut integration

The payment vault calls an adapter that evaluates the published TapeOut circuit before releasing tokens. The six-input policy is `ALLOW = A ∧ B ∧ C ∧ D ∧ (E ∨ F)`. Inputs are derived from authenticated evidence and contract state, rather than supplied as arbitrary client booleans. The policy requires an authorized service, verified successful provider receipt, authorized charge, valid session, and either compliance with the soft limit or a customer-signed override. Hard caps and replay protection are enforced separately.

| X Layer mainnet, chain 196 | Address / ID |
| --- | --- |
| TapeOut processor | `0x67be9042961344ccd387b04C24747B0c6C6D2212` |
| Circuit ID | `4` |
| Policy adapter | `0x87DB7961f425dDb39c54a8582D21f91a57C637B5` |
| Customer/session vault | `0x12412460847A865B29406fd8cd37dF91dd881B50` |
| Service registry | `0xEC4839B1BDfAC9450feEb211Cf59A7cF075110f3` |
| Zero-value DemoUSD | `0x66D16469E07217E53618887B492b14eA732b5a11` |

The stateless circuit uses eleven NAND gates. TAP-13 response verification binds delivery to the service and request; the AI service also exposes signed provider-reported usage with recomputed pricing. These standards are drafts. Provider signatures attribute reported results and usage; they do not establish AI correctness or customer acceptance.

## Target users and commercial model

Initial users are AI utility developers, API providers, and agent operators who need request-level billing with a fixed spending envelope. The first distribution hypothesis is hands-on integrations with a small number of AI/API builders, supported by the SDK, two working service examples, and inspectable receipts. No outreach or acquisition results are claimed.

The proposed business model is a 1–2% fee on successfully settled API payments, with provider analytics plans later. Providers would pay to avoid building their own billing and payment enforcement; customers would return for transparent prices, reusable credit, spending controls, and verifiable payment history. Fees, analytics subscriptions, and commercial revenue are not implemented or demonstrated.

## Delivered during the event

The local project history begins on 19 November 2026. It records the circuit/payment proof, multi-customer registry and vault, bounded session SDK, authenticated gateway and signed services, customer/provider interface, and hosted Convex/Vercel launch. Historical deployment journals preserve each checkpoint separately.

The hosted gateway proof includes three settled mainnet requests: two JSON validations and one actual Otari AI analysis. Two independent RPCs agree on **0.09 DEMO paid** and **0.01 DEMO refunded directly to the customer**. The AI response reports 88 input and 58 output tokens; its reported cost recomputes to **$0.00001820**. The public AI runtime has a **$0.01 total estimated/reported cost cap**.

The complete browser journey is separately exercised on a disposable historical fork, including four settlements and one explicitly labeled offline AI fixture. These fork records and builder-controlled mainnet wallets do not demonstrate independent adoption. No new payment or AI request is required to reverify the published mainnet records.

## Remaining before submission

- Record and publish an actual app walkthrough of no more than three minutes, using the [recording outline](demo-script.md).
- Arrange independently controlled tester wallets, confirm their DEMO/OKB funding, and record honest feedback and outcomes.
- Verify the official form and final deadline; complete personal/team fields and submit when authorized.
- Retain the form's confirmation and final video link. Explorer source verification remains separate from public GitHub source.
