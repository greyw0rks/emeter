# Public hosting

The production app is [emeter-peach.vercel.app](https://emeter-peach.vercel.app), with [emeter-greyw0rks-projects.vercel.app](https://emeter-greyw0rks-projects.vercel.app) as its team alias. The production gateway is [first-eel-292.convex.site](https://first-eel-292.convex.site/api/protocol). Both use existing USDC on X Layer chain 196 with the separately deployed USDC vault. The [USDC release](usdc.md) records the exact token, vault and public verification.

The public source is [greyw0rks/emeter](https://github.com/greyw0rks/emeter). The preceding light sidebar build with explicit OKX wallet selection is deployment `dpl_6y35ExewfKFtwUJn2Lg1Kfnxw6pF`, created on 23 November 2026. Its wallet fix and validation are recorded in `docs/evidence/frontend-okx-wallet-release-checks.json`. The original sidebar release remains in `docs/evidence/frontend-sidebar-release-checks.json` (`dpl_GHyphgAqU1NqKsY9GEPkoJfFkbc4`); the preceding horizontal-navigation launch remains in `docs/evidence/launch-release-checks.json` (`dpl_57uTGSzYrUzHsxmwubf16zpsGMRE`).

The current USDC release is Vercel deployment `dpl_AhrFxk2aYjFybXAytWtKwnZ2nKnL`, Ready with both established production aliases. [Public USDC checks](evidence/frontend-usdc-public-checks.json) verify eight desktop/mobile behaviors without signatures, wallet transactions or paid calls.

## Convex

Project `greyw0rks/emeter` uses production deployment `first-eel-292` and development deployment `kindhearted-leopard-863` (`dev/validation`). [convex.json](../deployments/convex.json) records their public references. Production stores gateway/provider records and scheduled jobs in Convex. The PostgreSQL/Redis reference services and their data remain local.

Authenticate the Convex CLI for this project, then deploy the functions:

```sh
rtk pnpm exec convex deploy --yes
```

The external runtime file contains dedicated provider/relayer keys, dispatch secret, Otari credential, origins, confirmation/gas limits, and execution flag. Keep it outside the repository with mode 0600. The existing operator key stays local and is absent from that runtime file. The configuration helper suppresses CLI output that could echo secrets and deliberately overwrites only the values supplied by the authorized file:

```sh
rtk pnpm exec tsx scripts/deploy/configure-convex.ts production
```

The enabled production file preserves `EMETER_MAINNET_ENABLED=true` and the exact production browser aliases. Development remains read-only with mainnet execution disabled. Configuration and function deployment do not register services, create customer sessions, or broadcast proof transactions.

## Vercel

The `emeter` project in `greyw0rks-projects` uses root directory `apps/web`, Next.js, Node 22.x, `pnpm install --frozen-lockfile`, and `pnpm build`. Set these **production project environment variables** before deploying:

| Variable | Value |
| --- | --- |
| `EMETER_PUBLIC_GATEWAY_URL` | `https://first-eel-292.convex.site` |
| `EMETER_PUBLIC_RPC_URL` | `https://rpc.xlayer.tech` |

`apps/web/vercel.json` also records the public settings and framework commands. When deploying from the repository root, select that configuration explicitly; the project environment variables persist across later deployments:

```sh
rtk proxy vercel deploy --prod --yes --no-wait --local-config apps/web/vercel.json --scope greyw0rks-projects
```

[.vercelignore](../.vercelignore) excludes environment files, review artifacts, tests, scripts, dependencies, contract build outputs, and build metadata. `/api/config` must return the hosted gateway and public RPC, with the pinned deployment addresses. No populated credential file belongs in the upload.

Convex permits the two exact production aliases plus the two established loopback development origins. New preview/custom domains need their own explicit origin entry. Production aliases remain stable across deployment URLs.

## Readiness and evidence

`GET /api/protocol` reports the current network, pinned vault/registry/token, confirmation depth, canonical block anchor, and `paidExecutionReady`. Workers and the indexer run on the durable Convex scheduler. Idle maintenance runs every 60 seconds; pending work schedules faster passes. Each invocation scans at most four 100-block ranges, matching both RPCs' query limit. Cursor and heartbeat freshness use a 75-second window.

The relayer was funded with 0.001 OKB, independently of the 0.1 DEMO proof session. Runtime AI spending is capped at $0.01 total estimated/reported cost; unknown costs stay reserved. The completed mainnet activation record and signed request evidence are separate from fork tests. [gateway-mainnet-verification.json](evidence/gateway-mainnet-verification.json) verifies all three payments, direct customer refund, immutable terms, and exact gas/token accounting through both RPCs.

```sh
rtk pnpm verify:gateway
rtk proxy node apps/web/test/launch-browser.mjs public
```

The first command verifies published signed records with live RPCs and needs no signer by default. Its `--refresh` mode authenticates the existing operator locally to fetch owned records. The second checks anonymous public access, production configuration, CORS, canonical RPC agreement, service terms, responsive navigation, and runtime errors. It grants no wallet permission and performs no paid request.
