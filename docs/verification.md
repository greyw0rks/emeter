# Verified protocol proof

Completed on **19 November 2026** on **X Layer mainnet, chain ID 196**. This completes the first Codex implementation task. The subsequent [payment-engine milestone](payment-engine.md) extends this foundation with service registration, price versions, and capped delegated sessions.

## Deployed contracts

| Contract | Address |
| --- | --- |
| Existing TapeOut processor | [`0x67be9042961344ccd387b04C24747B0c6C6D2212`](https://www.oklink.com/xlayer/address/0x67be9042961344ccd387b04C24747B0c6C6D2212) |
| Circuit ID | **4** |
| EmeterPolicyAdapter | [`0x87DB7961f425dDb39c54a8582D21f91a57C637B5`](https://www.oklink.com/xlayer/address/0x87DB7961f425dDb39c54a8582D21f91a57C637B5) |
| EmeterProofVault | [`0xC9aBeDD7A7373D0794Bb7F2C72E88457d9E4afbd`](https://www.oklink.com/xlayer/address/0xC9aBeDD7A7373D0794Bb7F2C72E88457d9E4afbd) |
| DemoUSD | [`0x66D16469E07217E53618887B492b14eA732b5a11`](https://www.oklink.com/xlayer/address/0x66D16469E07217E53618887B492b14eA732b5a11) |
| Circuit container | `0xFDd96def422295595959F071669CABcB241cf6A7` |

The processor already existed. emeter published an original policy circuit on it, then deployed its own adapter, proof vault, and zero-value demo token. The container address is computed from the real circuit NFT; full TAP-11 service-manifest registration is future work.

Policy: `A ∧ B ∧ C ∧ D ∧ (E ∨ F)`, **6 inputs, 1 output, 0 state bits, 11 NAND gates, 77 bytes**.

Netlist hash: `0x41c201911784832fb02bbdaab166a9150148b4ab657ee8489658f0602d501fe5`.

## Mainnet transactions

| Action | Actual result | Transaction |
| --- | --- | --- |
| Publish policy | Circuit #4, 11 gates, no state | [0x86bc…8448](https://www.oklink.com/xlayer/tx/0x86bcaffab3ea00881f4934cb48e537ac879049e145a9c102ea2fd02c27178448) |
| Fund session | 0.20 DEMO deposited | [0x2c7b…7dc1](https://www.oklink.com/xlayer/tx/0x2c7b03866057c87a259452c940415f48edf5ade196bdf1324643852605727dc1) |
| Allowed charge | 0.05 DEMO settled; circuit inputs `0x1f` | [0x96fa…159c](https://www.oklink.com/xlayer/tx/0x96fa8e32843b764fd069852346394b053be601adcf9c646d67eef674cf9c159c) |
| Soft-limit charge | Real transaction reverted; `PolicyDenied(15)`, input `0x0f` | [0x7c76…e5a9](https://www.oklink.com/xlayer/tx/0x7c7632144193bf86873d953257b523b73e46687b8e5be6704ab085227e0be5a9) |
| Customer-signed override | Another 0.05 DEMO settled; inputs `0x2f` | [0x56f8…48c2](https://www.oklink.com/xlayer/tx/0x56f89d27f7241f4aa06664f32b8e9a4463fc40b996f36807fa277499441448c2) |
| Refund | Unused 0.10 DEMO returned after the locked window | [0x292d…1e29](https://www.oklink.com/xlayer/tx/0x292dcdf478c4a4bb08647afcd7ed00e3fa9cc64673753625b6e87af35f991e29) |

All **12 broadcasts** are recorded in [the mainnet journal](../deployments/xlayer-196.json): 11 successful receipts and one intentional reverted denial. Views and simulations are not counted as transactions.

Token balances at this proof's completion: customer **0.90 DEMO**, provider **0.10 DEMO**, vault **0**. Total paid: **0.10 DEMO**. The provider receives no payment from the denied transaction. These historical balances precede later payment-engine activity; verification pins this proof's completion block rather than assuming the wallets never transact again.

Total actual OKB spent, including protocol charges and transaction gas: **0.002157970982 OKB**. The wallet balance decreased from **0.009910120668085113** to **0.007752149686085113 OKB**, matching the receipt-based calculation exactly. No BEM purchase or real-value customer payment token was used.

## Protocol-milestone checks

| Check | Result |
| --- | --- |
| TypeScript tests | **107 passed**: 91 circuit/compiler/vector tests, 12 receipt/money tests, 2 gateway checks, 2 SDK checks. |
| Foundry unit/fuzz tests | **33 passed**; fuzz tests ran 256 cases each. Forgery, chain/vault binding, replay, hard limits, expiry, safe refunds, malformed output, return bombs, and processor failure are covered. |
| Foundry tests against deployed X Layer code | **3 passed**: publication/full truth table, allowed/denied/override settlement, locked refund. Fork mutations are local only. |
| Official Python interpreter | **64/64** emeter policy vectors agree; netlist round-trip and gate/state counts agree. |
| Anvil fork | Complete **12-transaction** lifecycle passed before mainnet execution; [fork artifact](evidence/anvil-fork-proof.json) is explicitly labelled `anvil-fork`. |
| Build and typecheck | pnpm workspace and Next.js production build passed; Solidity 0.8.30/Cancun compiled. |
| Live independent verification | `rpc.xlayer.tech` and `xlayer.drpc.org` agree on all 12 transaction inputs/receipts, all 64 policy inputs, creation bytecode/configuration, settlement events, refund, and final balances. |
| Historical denial | Re-executing the original transaction against its real predecessor-block state returns `PolicyDenied(15)` on both providers. |

The independent verification report is [mainnet-verification.json](evidence/mainnet-verification.json). Each run records its pinned block; the first complete check used **76354810**. The historical adapter also accepts `0x1f` and rejects `0x0f` at the same predecessor-block state. Creation calldata matches locally compiled artifacts; this is distinct from explorer source-code publication. Explorer source verification remains a submission-hardening task. The public RPC declined the optional debug-trace request; historical `eth_call`, receipts, and source/input verification succeeded.

These are mined receipts with confirmations, not a claim of Ethereum L1 finality or an independent audit. The TapeOut factory remains unsealed. [The threat model](threat-model.md) explains the remaining trust.

## Reproduce without spending

```sh
pnpm install
pnpm contracts:install
pnpm circuit:generate
pnpm test
pnpm typecheck
pnpm build
python3 scripts/verify/reference-check.py
X_LAYER_RPC_URL=https://rpc.xlayer.tech pnpm test:fork
pnpm proof:local
pnpm verify:deployment
```

Tests and Anvil forks use local test balances and generated process-memory signers. The final verification command performs reads only. Private keys are not present in the repository.

## Product boundary

The signed workload was an actual local schema validation inside the runner. Both wallets belong to the builder. This is a circuit-enforced payment proof, not an independent user test or a hosted AI API demo. The subsequent payment engine implements the registry, delegated sessions, and SDK signing helpers. Hosted TAP-13/17 services, database/indexer, SDK HTTP execution, wallet UI, and the application screens remain to be built.
