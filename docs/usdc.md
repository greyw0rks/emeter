# USDC payments on X Layer

The selected payment asset is USDC on X Layer, chain 196:
`0x74b7F16337b8972027F6196A17a631aC6dE26d22`, six decimals.
X Layer's [official documentation](https://github.com/okx/xlayer-docs/blob/main/developer/bridge/usdc-on-x-layer.mdx) recommends this token. It follows Circle's Bridged USDC Standard; this is not a claim that it is native Circle-issued USDC. The older USDC.e at `0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035` is a different token and is not accepted.

Users obtain the selected USDC by withdrawing from OKX with **X Layer** selected, or by using a bridge that delivers this exact token on X Layer. They also need OKB on X Layer for wallet transaction gas. The deposit form provides funding guidance and a copyable token address. Wallet approvals are restricted to the requested deposit amount.

## Activation

USDC is deployed and active in the [public app](https://emeter-peach.vercel.app) and production Convex gateway. The new vault is `0x90A84f7dca90621827876febF2468Ba0591801c9`, deployed at block `76700684` in transaction [`0x585370c5…db490`](https://www.oklink.com/xlayer/tx/0x585370c5d6bbcfb607ecb85c9e6100205714de03ef53dd19545dbb28ab5db490). Both independent RPCs verified the receipt, exact deployment calldata, USDC token, registry and policy adapter. Actual deployment gas cost was **0.000070839912 OKB**, below the user-approved 0.0002 OKB cap, with zero USDC transfers. Vercel production deployment `dpl_AhrFxk2aYjFybXAytWtKwnZ2nKnL` is Ready with both established production aliases.

The old vault's token is immutable DEMO; changing its label cannot migrate it. `deployments/xlayer-196-usdc.json` records the separate USDC vault. Fresh configurations fail with `USDC_DEPLOYMENT_PENDING` until a USDC vault exists; they never silently fall back to DEMO.

`pnpm verify:usdc` checks the official token's name, symbol, decimals and bytecode through two independent RPCs and estimates deployment gas without signing. `pnpm test:usdc:fork` checks deposits, exact approvals, withdrawals, signed payments, spending-limit denial/override, closure and direct wallet refunds against the actual USDC and TapeOut contracts on a local fork. The browser flow can also use actual USDC with `EMETER_BROWSER_USE_USDC=true`, preserving historical DEMO artifacts with `EMETER_BROWSER_ARTIFACT_LABEL=usdc`. Fork funding does not move real USDC. `pnpm deploy:usdc` prepares one vault-creation transaction; `--broadcast` signs and broadcasts it with a maximum padded gas cost of **0.0002 OKB**. The script makes zero USDC transfers and preserves signed bytes externally before broadcast so retries resume the same transaction.

Production Convex and the external runtime file use `EMETER_PAYMENT_ASSET=USDC`, the new `EMETER_VAULT_ADDRESS`, and `EMETER_INDEXER_START_BLOCK=76700684`. Execution was disabled during the switch, then reopened after the canonical indexer and new worker heartbeat were verified. The Vercel server uses the completed checked-in deployment record. `/api/protocol` and `/api/config` select the same USDC token and vault. Existing provider registrations and the policy adapter are reused. Browser wallet actions verify the vault's actual token, registry, adapter and token decimals against the configured addresses before signing.

Old DEMO sessions and requests retain their original token/vault. Current balances, spend totals, reservations, recovery jobs and indexer rebuilds are scoped to the current payment deployment. PostgreSQL uses the additive `20261123210000_payment_asset` migration; missing legacy Convex fields are interpreted as DEMO. Old DEMO proofs remain historical evidence and do not establish a real USDC payment.

DEMO mode is retained only for disposable historical fork tests, with both `EMETER_PAYMENT_ASSET=DEMO` and `EMETER_NETWORK_MODE=local-fork`. It is refused in mainnet mode.
