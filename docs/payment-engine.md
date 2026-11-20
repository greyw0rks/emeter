# Payment engine

The second emeter milestone adds registered services, immutable price versions, prepaid customer credit, and capped delegated spending sessions. Every settled charge still calls the existing TapeOut policy adapter; an allow verdict is required before the provider receives DEMO.

## Implemented behavior

- An allowlisted provider registers a service with its payout wallet, receipt signer, container identity, price, and metadata hash. Price changes publish a new immutable version.
- Customers deposit credit or receive a sponsored deposit. A customer-signed EIP-712 grant locks exactly the approved budget, service set, session key, per-request maximum, soft limit, and time limits.
- A delegated key signs each bounded request. Settlement authenticates its charge, provider-signed TAP-13 receipt digest, versioned price, session state, budget, and replay identifiers before evaluating the six-bit circuit policy.
- Crossing the soft limit requires a separate customer signature for that exact charge and cumulative spending cap. The delegated key cannot authorize its own override, and an override cannot exceed hard limits.
- Early closure preserves the original settlement window for outstanding work. Emergency key revocation invalidates pending charges. Refunds after the original window always return the remaining balance to the customer.
- The vault exposes no administrator withdrawal. Available credit, locked funds, and settled spending remain separate, and failed payments roll back accounting and replay identifiers.

`EmeterSessionClient` reads live quotes and sessions, prepares bounded typed data, signs customer grants and delegated charges, and produces session-creation transaction calldata. The SDK is a workspace package; a published package and paid HTTP `execute` journey are later work.

## Validation

The payment-engine checkpoint passed **192 tests**: 91 circuit/compiler tests, 17 shared receipt/payment-schema tests, 9 SDK tests, 2 gateway scaffold tests, and 73 Foundry unit/fuzz/invariant tests. Foundry counts the four invariant obligations as one grouped test; their randomized handler ran 128 sequences of 32 operations, totaling 4,096 calls. The invariants compare vault balances, isolated session budgets, provider transfers, and total token conservation against independent accounting.

Three additional Foundry tests pass against the real X Layer processor on a local fork: scoped delegated requests and customer-only overrides, preserved signed price versions, and outstanding settlement followed by refunds. Fork changes stay local. Workspace typechecks and the Next.js/Solidity production build pass.

The completed [Anvil rehearsal](evidence/engine-anvil-proof.json) exercises eighteen transactions with the existing mainnet DemoUSD, adapter, and processor forked locally. The registry and vault bytecode SHA-256 hashes match the artifacts prepared for mainnet:

| Contract | Creation bytecode SHA-256 |
| --- | --- |
| EmeterRegistry | `99c4280b97bc32923bd1d7639c8e8c07c867e7cdf7bce5face278526e092519d` |
| EmeterVault | `33235a7c31bcd4f3ae7f736786d1520ce14c72ce7660c1eb4acdd51578600e4d` |

## Mainnet deployment

Completed on **19 November 2026 UTC** on **X Layer mainnet, chain ID 196**. The registry and session vault reuse the original zero-value DemoUSD, policy adapter, existing TapeOut processor, and emeter circuit **4**.

| Contract | Address |
| --- | --- |
| EmeterRegistry | [0xEC4839B1BDfAC9450feEb211Cf59A7cF075110f3](https://www.oklink.com/xlayer/address/0xEC4839B1BDfAC9450feEb211Cf59A7cF075110f3) |
| EmeterVault | [0x12412460847A865B29406fd8cd37dF91dd881B50](https://www.oklink.com/xlayer/address/0x12412460847A865B29406fd8cd37dF91dd881B50) |
| DemoUSD | [0x66D16469E07217E53618887B492b14eA732b5a11](https://www.oklink.com/xlayer/address/0x66D16469E07217E53618887B492b14eA732b5a11) |
| EmeterPolicyAdapter | [0x87DB7961f425dDb39c54a8582D21f91a57C637B5](https://www.oklink.com/xlayer/address/0x87DB7961f425dDb39c54a8582D21f91a57C637B5) |
| TapeOut processor, circuit 4 | [0x67be9042961344ccd387b04C24747B0c6C6D2212](https://www.oklink.com/xlayer/address/0x67be9042961344ccd387b04C24747B0c6C6D2212) |

The completed [mainnet journal](../deployments/xlayer-196-engine.json) records all **18 broadcasts**: **17 successful receipts** and **one intentional reverted denial**. Both sessions are refunded, with no funds left in the vault.

| Action | Actual result | Transaction |
| --- | --- | --- |
| Settle a quote signed before a price update | 0.02 DEMO paid at version 1 after version 2 was published; circuit inputs `0x1f` | [0x962c…03f6](https://www.oklink.com/xlayer/tx/0x962c09927702a75e84500f1bcc46a20d14d2204e8716378b2a279d7f466203f6) |
| Delegated key attempts its own override | Transaction reverted with `PolicyDenied(15)`; inputs `0x0f`, no payment | [0x5d40…8082](https://www.oklink.com/xlayer/tx/0x5d40152cfc93c9245c66c5560a26fbdbd5fe6aa19d4ec69e476af43c37a98082) |
| Customer authorizes the same charge | 0.05 DEMO paid under the separate customer override; inputs `0x2f` | [0x51ff…1e18](https://www.oklink.com/xlayer/tx/0x51ffe90a477b8894d89db6aec67616a72376aefab31ab6c7cafcfa92fe0e1e18) |
| Second customer's scoped session | 0.03 DEMO paid at version 2; inputs `0x1f` | [0x7a86…2a65](https://www.oklink.com/xlayer/tx/0x7a86bcc97443d5146631a4e85aefda0a0abfc0bd8bb702d9f804138fcff02a65) |
| Refund the closed first session | 0.13 DEMO returned after its original settlement window | [0xe531…dfdf](https://www.oklink.com/xlayer/tx/0xe531f2c853e1e81201e86b9b3339f6d3f33e85120fb49545dbda1ca63c48dfdf) |
| Refund the second session | 0.17 DEMO returned to its recorded customer | [0x19db…a999](https://www.oklink.com/xlayer/tx/0x19db4b4acad2feabf077cb7e454e479b77876038201433993e84a55dfd47a999) |

Each customer granted a 0.20 DEMO hard budget, a 0.05 DEMO soft limit, and a 0.05 DEMO per-request maximum. The first session allows the registered JSON validator and word-count services; the second permits only the JSON validator. The mainnet run uses an additional native gas ceiling of **0.0015 OKB** and pays providers only in zero-value DEMO.

Total paid is **0.10 DEMO** and total refunded is **0.30 DEMO**. Customer one spent **0.07 DEMO**; customer two spent **0.03 DEMO**. Final wallet balances are **0.63 DEMO** and **0.37 DEMO** respectively; available credit, locked funds, and vault token balance are all **zero**.

The run's actual gas cost was **0.000153605122 OKB**. The deployment wallet decreased from **0.007752149686085113** to **0.007598544564085113 OKB**, exactly matching receipt-based fees.

`pnpm verify:engine` performs independent read-only verification through `rpc.xlayer.tech` and `xlayer.drpc.org`. It checks creation calldata against compiled artifacts, every transaction's inputs and mined receipt, immutable price terms, service scope, customer/delegate identities, settlement events, refunds, historical denial, and exact token/native fee accounting. This is separate from explorer source publication, which remains submission work.

Both providers agree on all eighteen transactions and final accounting at proof block **76360367**. Replaying the delegated override attempt against its actual predecessor-block state returns `PolicyDenied(15)` on both providers. [The independent verification report](evidence/engine-mainnet-verification.json) and [recorded checks](evidence/engine-checks.json) preserve the results. The original twelve-transaction circuit proof also passes historical verification after these later wallet transfers.

## Reproduce without spending

```sh
pnpm install
pnpm contracts:install
pnpm test
pnpm typecheck
pnpm build
X_LAYER_RPC_URL=https://rpc.xlayer.tech pnpm test:engine:fork
pnpm proof:engine:local
pnpm verify:engine
```

The local rehearsal generates temporary signing keys in process memory. It impersonates the DemoUSD minter only within Anvil and records `mainnetBroadcastPerformed: false`. Onchain deployment uses an authorized signer source outside the repository and an explicit `--broadcast` flag; deployment scripts refuse to overwrite an existing mainnet journal. If a run is interrupted, reconcile its recorded pending transaction and existing contracts before doing any further deployment.

## Product boundary

The engine proof uses two builder-controlled customer wallets and actual local JSON validation and word-count computations. This establishes payment behavior and receipt attribution, not independent adoption, a hosted AI service, or AI output correctness. The [threat model](threat-model.md) describes provider-reported timestamps, revocation, and the experimental upstream upgrade boundary.

The next milestone connects this engine to the paid HTTP gateway, actual AI Text Analyzer and JSON Validator, developer authentication/API credentials, PostgreSQL records, settlement jobs, and chain indexing. The full customer interface and live circuit visualization follow those lifecycle records.
