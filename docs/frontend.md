# Frontend workspace

The Next.js app connects the selected light workspace to the gateway and deployed X Layer payment engine. It includes the landing page, customer credit and session overview, verified service catalog, provider registration and scoped credentials, bounded execution playground, receipt inspector, and six-input policy explorer.

The public app is [emeter-peach.vercel.app](https://emeter-peach.vercel.app). It uses the production Convex gateway and public X Layer RPC described in [hosting.md](hosting.md). The selected design has a white header for identity/network/wallet controls, a persistent left sidebar, and a pale working surface within a rounded white frame. On phones, account controls wrap and the sidebar becomes an icon rail. Every destination keeps its accessible name and current-page state; navigation targets are at least 44px square. Actual account/session data and verified catalog services drive the pastel working surfaces.

The circuit visualization uses the same eleven NAND gates as `@emeter/circuit`. Desktop uses React Three Fiber when WebGL is available; mobile, reduced motion, and graphics failures use the same SVG netlist. Preview controls sign nothing. A recorded circuit uses independently checked request evidence and labels its input mask unconfirmed until a matching canonical settlement is verified.

## Run locally

Use Node 22.12 or newer and the workspace’s pnpm version. Configure and start the gateway, providers, workers, PostgreSQL, Redis, and indexer as described in [gateway.md](gateway.md). Copy the public settings from `.env.web.example` to `apps/web/.env.local`, matching the running gateway and its exact fork RPC.

```sh
rtk pnpm dev:web
```

The web app runs on port 3100. `EMETER_PUBLIC_GATEWAY_URL` defaults to `http://127.0.0.1:4100`. Set `EMETER_PUBLIC_RPC_URL` explicitly for a local fork. Set `EMETER_BROWSER_ORIGINS` on the gateway to the web origin; defaults allow `http://127.0.0.1:3100` and `http://localhost:3100`. Public gateway/RPC settings require HTTPS, with HTTP allowed only on loopback.

The app’s `/api/config` exposes only public gateway/RPC settings and established deployment addresses. It reads no gateway signing keys, provider dispatch secrets, database credentials, or Otari key files.

## Wallet and execution behavior

Login uses the SDK’s origin-bound wallet challenge. A login grants no spending permission. Deposits approve only the amount needed; session creation separately signs the hard budget, soft limit, per-request maximum, expiry, and service scope.

Mainnet and an Anvil fork both use chain ID 196. Before every wallet signature and transaction, the app checks the wallet’s hash for an exact gateway block. It independently checks the configured browser RPC against that anchor and pins the token, registry, and vault to the completed deployment. A mismatched wallet cannot sign or broadcast through the app.

Delegated keys, login tokens, and API credentials remain in memory. Account/network changes clear identity and session signing material, and invalidate in-flight signing and execution calls. Lost tab keys leave wallet-based closure, signer revocation, refunds, and withdrawal available. Only a pending transaction’s public hash, target, calldata hash, owner, label, and RPC are retained in session storage for recovery.

A wallet timeout or failed transaction verification retains its pending hash and blocks replacement actions. Rechecking independently verifies the sender, target, calldata, zero native value, confirmed receipt, and canonical block. When a wallet returns no hash, the user can enter the hash from its activity to recover the action.

Each execution holds one client request ID and signed authorization. Status failures retain that request for recovery. An explicit customer approval names the precise cumulative cap when a soft limit would be crossed. Results, signed receipts, gateway policy inputs, and actual canonical payments remain separate UI states. The receipt inspector also verifies original immutable service terms, response/usage hashes, provider and charge signatures, and the matching settlement call/event through the SDK.

Credential refresh updates the existing SDK client's bearer token without replacing its retained signed payloads. An explicit run or recovery can issue a fresh session credential from the signed-in wallet when the previous one was revoked or expired. The request ID, nonce, and authorization stay fixed. The playground preserves its current service/session when navigated away from, and stops status polling before publishing a final independently verified result.

Overview shows current available credit and rereads its recent sessions from chain. Request totals come from indexed gateway records; reservations include pending and indeterminate outcomes. Lists are intentionally bounded to recent records; the receipt lookup can inspect older owned requests by ID.

## Verification

```sh
rtk pnpm typecheck
rtk pnpm test
rtk pnpm build
rtk pnpm --filter @emeter/web test:browser
```

The browser proof uses a disposable PostgreSQL database, isolated Redis queues, and a real Anvil fork of the existing engine. The fork defaults to the completed engine proof's recorded block/hash, before production registration of the built-in service IDs; its new activity clock is synchronized for fresh receipt timestamps. `EMETER_TEST_FORK_BLOCK` can select another valid source block explicitly. Its EIP-1193 wallet binding keeps temporary wallet keys in Node and restricts broadcasts to the fork’s known contracts. It exercises provider registration, wallet login, exact deposits, bounded sessions, JSON/schema and labeled offline AI execution, receipt/payment checks, customer overrides, request recovery, credentials, network mismatch refusal, and wallet recovery after key loss. It captures desktop/mobile states and checks keyboard dialogs, reduced motion, browser errors, page overflow, and full visibility of the active navigation item. No paid AI call, mainnet broadcast, or independent adoption is implied by this fork proof.

See [frontend-launch-fork-checks.json](evidence/frontend-launch-fork-checks.json) for the current browser verification. Earlier [frontend-fork-checks.json](evidence/frontend-fork-checks.json) and [frontend-release-checks.json](evidence/frontend-release-checks.json) preserve the prior milestone. The actual hosted mainnet proof is [gateway-mainnet-verification.json](evidence/gateway-mainnet-verification.json). Public browser smoke evidence is [frontend-public-checks.json](evidence/frontend-public-checks.json); it uses no wallet signatures, transactions, or paid AI calls.

The extracted visual system is documented in [DESIGN.md](../DESIGN.md), with ten standalone component previews in [design.json](../.impeccable/design.json). Their syntax, token references, and snippets passed static checks; isolated preview rendering remains unverified. The [launch finish review](../.impeccable/review/launch-finish-review.md) and its recapture verdict record the current review scope and findings. The original milestone review remains historical.
