# Architecture

The payment engine extends the original circuit proof with a service registry and a multi-customer vault. `EmeterRegistry` records allowlisted providers and immutable price versions. `EmeterVault` holds prepaid credit, locks customer-signed session budgets, verifies delegated request signatures and provider receipts, and enforces the real TapeOut verdict before each token transfer. The original `EmeterProofVault` remains a separate, historical proof deployment.

```mermaid
flowchart LR
    Customer[Customer wallet] -->|Deposit and signed session budget| Vault[EmeterVault]
    Customer -->|Authorize capped signing key| Delegate[Session signer]
    Delegate -->|EIP-712 bounded charge| Relayer[Settlement relayer]
    Provider[Provider signing key] -->|TAP-13 digest signature| Relayer
    Provider -->|Publish service and price version| Registry[EmeterRegistry]
    Relayer -->|Authenticated evidence| Vault
    Registry -->|Service permission, fixed price, signer, payout| Vault
    Vault -->|Derived six-bit policy| Adapter[EmeterPolicyAdapter]
    Adapter -->|eval circuit ID and bits| Processor[TapeOut processor on X Layer]
    Processor -->|ALLOW or DENY| Adapter
    Adapter -->|Enforced verdict| Vault
    Vault -->|Allowed payment| Payout[Provider DEMO balance]
    Vault -->|Unused balance after window| Customer
```

`DemoUSD` is a zero-value, six-decimal ERC-20 with restricted minting and a fixed supply cap. Deployment pays native OKB protocol fees and gas; customer payment tests use DEMO.

## Policy inputs

`ALLOW = A ∧ B ∧ C ∧ D ∧ (E ∨ F)`

| Bit | Input | Vault source |
| --- | --- | --- |
| 0 | A: service authorized | Service is in the customer's signed service set; provider, service, and selected price version remain enabled in the registry. |
| 1 | B: receipt verified | TAP-13 digest signature reports `ok=true`, recovers to the selected price version's provider signer, and binds the authorized request and result. |
| 2 | C: charge authorized | EIP-712 signature validates against the session key; the selected version's fixed price is within the signed request maximum. |
| 3 | D: session active | Funds are not refunded and settlement is within the locked window. Reported execution time must precede session expiry. |
| 4 | E: within soft limit | `spent + price <= softLimit`, computed with integer arithmetic. |
| 5 | F: explicit override | A separate customer-signed EIP-712 grant binds this exact charge digest and caps resulting cumulative spending. The delegated key cannot approve its own override. |

The client never supplies arbitrary policy booleans to the vault. Balances, hard budgets, authorization expiry, receipt freshness, request binding, and consumed IDs/nonces are checked before circuit evaluation. A soft-limit denial remains a genuine circuit decision even when all hard constraints and signatures are valid.

The adapter checks factory registration, the actual processor's factory link, exact circuit metadata, and the generated netlist hash at construction. Every evaluation checks registration, processor/implementation code hashes, beacon implementation, metadata, and netlist bytes. Calls use bounded gas and fixed-size return buffers. Only canonical ABI-encoded `0x01` permits payment.

The vault consumes a session-scoped request ID, charge nonce, and provider receipt digest only after an allowed verdict. A denied charge can be retried with a customer-signed override; it cannot be settled twice. Monetary values use integer token base units throughout Solidity, shared schemas, SDK reads, and deployment reports.

## Session accounting and closure

Deposits become customer-owned available credit. A customer signature locks exactly the granted budget and records a canonical set of at most sixteen services, a signing key, per-request cap, soft limit, execution expiry, and settlement window. Creating a session cannot borrow another customer's credit or enlarge a signed grant. Customer and session-key authorization support EIP-1271 contract wallets as well as EOAs.

Price versions preserve the signer, payout, container identity, and exact price quoted to a request. Publishing a newer version does not rewrite an outstanding authorization. Providers or the registry owner can explicitly disable a compromised version, service, or provider; disabling it blocks settlement.

Closing a session stops newly reported execution but preserves its original `expiresAt + settlementWindow` refund deadline. Recently reported work from before the execution deadline may still settle during that window. Emergency key revocation deliberately invalidates pending charges without releasing locked funds early. After the original window, anyone may relay a refund, but the destination is always the recorded customer. Available credit is separately withdrawable by its owner. The vault has no administrator withdrawal function.

## Integration boundary

`EmeterSessionClient` reads live quotes and balances, prepares session and charge typed data, and produces signed session transaction calldata. The payment-engine proof exercises these methods with actual computations and onchain transactions. Its local JSON validation and word count are explicitly separate from the planned hosted AI Text Analyzer and JSON Validator.

The [paid gateway and SDK](gateway.md) implement wallet authentication, session/provider credentials, JSON validation, actual Otari AI analysis, TAP-13 responses, non-streaming usage evidence, PostgreSQL records, BullMQ execution/settlement jobs, and chain reconciliation. A session lock and fresh vault reads reserve each signed price; the database does not define available funds. Unknown provider completions retain reservations until recovery or expiry. Only verified canonical settlement events change payment status to settled, and the SDK independently confirms the transaction and receipt.

This gateway checkpoint was exercised on a local fork, including one real upstream AI call. The full Electric precision interface and public mainnet gateway activation are next. [Payment-engine verification](payment-engine.md) retains the independent mainnet deployment evidence.
