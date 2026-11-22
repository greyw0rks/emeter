# Three-minute app demo recording outline

Target runtime: 2 minutes 50 seconds. This is a recording outline, not a recorded video. Use the actual application and label historical proof or local-fork footage where it appears.

| Time | Screen / action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Public landing page and six-input policy preview | “AI and API developers need per-request billing. Their customers need a hard spending limit. emeter connects published prices, prepaid credit, and signed results to payments enforced by a TapeOut circuit on X Layer.” |
| 0:20–0:40 | Services: JSON Validator and AI Text Analyzer, verified terms and prices | “Providers publish immutable service terms. Customers see the exact price before signing a request. The same payment infrastructure supports JSON validation and AI text analysis.” |
| 0:40–1:10 | Overview: wallet login, credit, and bounded session controls | “A wallet login gives access to account records. Spending has a separate authorization: a budget, per-request cap, selected services, and expiry. The customer controls the session and unused funds.” |
| 1:10–1:40 | Playground: actual JSON input, execution status, output, then receipt | “Each request keeps its identity through retries. Delivery, receipt verification, and settled payment are separate states. Here is the returned result and its signed receipt.” |
| 1:40–2:10 | Receipt inspector: original price, verification, canonical transaction; Policy explorer | “The client checks provider and customer signatures, response hashes, original prices, and the mined payment. The vault enforces this eleven-NAND TapeOut circuit before tokens move. A soft-limit exception requires the customer; a hard budget cannot be overridden.” |
| 2:10–2:30 | Published mainnet evidence and explorer links | “The retained hosted proof contains three mainnet requests, including one actual AI call. Two independent RPCs verify 0.09 DEMO paid and 0.01 DEMO refunded. DEMO has no monetary value, and these are builder-controlled tests.” |
| 2:30–2:50 | Service/SDK view, then landing | “Our first customers are AI and API builders and the agents using their services. We propose a small fee on successful settlements, with provider analytics later. emeter: meter every request, control every payment.” |

Use an existing owned receipt for historical mainnet footage. A public anonymous visitor cannot inspect someone else's account receipts. New live execution requires a separately bounded customer session, DEMO credit, OKB for wallet transactions, and available AI budget. The outline does not authorize a new payment, raise the $0.01 AI cap, or create a tester account.

The existing browser proof can support actual interface footage on a local fork, labeled **“Local-fork walkthrough; separate mainnet proof shown next.”** Do not present the offline AI fixture as an upstream model call or treat the landing's interactive preview as an onchain transaction.

Keep wallet secrets, API credentials, and delegated keys out of the recording. Show only public contract addresses, transaction hashes, results intended for publication, and already published evidence. A provider signature establishes attribution, not AI quality or customer acceptance. Preserve these boundaries in the final voiceover.
