# Threat model

This is an experimental protocol proof using zero-value DEMO. Its security checks establish bounded authorization and circuit enforcement; they do not constitute an audit or production payment readiness.

| Threat | Current control | Remaining boundary |
| --- | --- | --- |
| Forged customer charge or changed price/service | EIP-712 includes chain ID, verifying vault, request ID/hash, service, max amount, nonce, deadline, and override. | Customer is an EOA in this proof; delegated session keys and contract-wallet signatures belong to the payment engine. |
| Forged provider response | Exact TAP-13 digest and low-s signature verification against immutable provider key. | Full TAP-11 resolution and key rotation are not implemented. |
| Provider reports a useless or incorrect result | Request and body are attributed to the provider. | Signature does not prove quality. Success reporting, delivery acknowledgement, and customer acceptance must remain separate. |
| Receipt moved to another request | Customer authorization and provider signature both bind ID and request hash. | Canonical JSON/transport parsing for untrusted HTTP requests is separate gateway work. |
| Duplicate settlement | Both request IDs and nonces are consumed on successful settlement. | Denial consumes neither; a fresh customer override can authorize the same outstanding request. |
| Overspending | Ledger balance and hard budget are enforced before evaluation; circuit applies soft limit/override. | Multi-session concurrency and job reconciliation remain to be built. |
| Refund races outstanding charges | Execution expiry and a locked settlement window precede refund. | Provider timestamps are reported evidence, not an independent clock or delivery proof. |
| Malformed, unavailable, or expensive processor | Exact metadata/netlist checks, bounded calls, strict output ABI, fail-closed denial. | Upstream circuit factory is unsealed and unaudited. |
| Upstream upgrade | Beacon implementation and processor/implementation code hashes are pinned and checked each evaluation. | A malicious owner can temporarily upgrade, alter storage, and restore code. These checks cannot prove storage history untouched. |
| Reentrancy and unsafe token calls | ReentrancyGuard, SafeERC20, effects before payout, fixed demo token. | Production token/provider allowlists are future work; this proof supports the deployed DemoUSD only. |
| Credential exposure | User-authorized signer file stays outside the repository; signing happens locally; public journals contain only addresses/signatures/receipts. | Online production provider keys and relayer operation need their own key management. |
| Fabricated settlement status | Actual transaction inputs, receipts, balances, circuit bytes, and verdicts are recorded. Fork artifacts are labelled separately. | A mined receipt with one confirmation is not a claim of Ethereum L1 finality. |

The vault exposes no administrator withdrawal of customer balances. Refunds remain available after the window even if the TapeOut adapter becomes unavailable. A reverting denial has no persistent contract event; its reverted transaction and the verified simulation reason provide the proof record.
