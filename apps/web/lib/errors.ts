import { EmeterGatewayError } from "@emeter/sdk";
import { walletErrorCode, walletRejected } from "./wallet";

const messages: Record<string, string> = {
  EXACT_DEMO_REQUIRED: "Enter a DEMO amount with up to six decimal places, such as 0.05.",
  INVALID_DEMO_AMOUNT: "Enter a positive amount within the token limit.",
  INSUFFICIENT_DEMO: "Your wallet needs more DEMO for this deposit. DEMO is a test token; it cannot be bought here.",
  INSUFFICIENT_CREDIT: "Deposit enough credit to cover this session budget.",
  INVALID_SESSION_LIMITS: "Keep the soft limit and per-request maximum within the hard budget. Select at least one service.",
  NO_WALLET: "No browser wallet was found. Open this page in a wallet browser or enable a wallet extension.",
  WALLET_CONNECTION_DECLINED: "The wallet connection was declined. Open and unlock your wallet, then approve Emeter’s connection request.",
  WALLET_NETWORK_DECLINED: "The switch to X Layer was declined. Select X Layer in your wallet, then try connecting again.",
  WALLET_SIGN_IN_DECLINED: "The wallet is connected, but the sign-in signature was declined. Try again and approve the emeter gateway authentication message. Signing in grants no spending permission.",
  WALLET_REQUEST_PENDING: "Your wallet already has a request waiting. Open the wallet and complete or dismiss that request before trying again.",
  WALLET_CHAIN_MISMATCH: "Your wallet is on another chain. Select X Layer (chain 196), then connect again.",
  WALLET_NETWORK_MISMATCH: "Your wallet and the gateway are on different versions of X Layer. Match the wallet RPC to the gateway network shown here, then connect again.",
  RPC_NETWORK_MISMATCH: "The configured browser RPC and gateway do not share the same block. Update EMETER_PUBLIC_RPC_URL to the gateway’s network.",
  WALLET_ACCOUNT_CHANGED: "Your wallet account changed. Connect and sign in again.",
  DEPLOYMENT_MISMATCH: "This gateway points to different contracts. Check its deployment configuration before connecting.",
  GATEWAY_ANCHOR_UNAVAILABLE: "The gateway could not read a current block. Retry when its RPC is available.",
  LOCAL_RPC_REQUIRED: "Set EMETER_PUBLIC_RPC_URL to the gateway’s local fork RPC, then restart the web app.",
  AUTH_REQUIRED: "Connect your wallet and sign in to continue.",
  INVALID_OR_EXPIRED_CREDENTIAL: "The credential is invalid, expired, or revoked. Sign in and create a new key for this resource.",
  SESSION_KEY_UNAVAILABLE: "This tab does not have this session’s signing key. Create a new session, or manage the existing one from Overview.",
  REQUEST_BUDGET_EXCEEDED: "The request price or maximum exceeds this session’s remaining budget or signed per-request limit. Adjust the maximum or create a funded session.",
  SESSION_UNAVAILABLE: "This session no longer accepts this request. Select an active session that allows the service.",
  PENDING_TRANSACTION: "Check the pending transaction before sending another wallet transaction.",
  UNKNOWN_BROADCAST: "The wallet did not return a transaction hash. Check its activity and enter the hash below to recover the transaction.",
  GATEWAY_NOT_READY: "The gateway is still preparing its provider, indexer, or workers. Retry when it reports ready.",
  PAID_EXECUTION_NOT_READY: "Paid execution is not configured on this gateway yet.",
  PROVIDER_NOT_ALLOWLISTED: "This wallet is not an approved provider. Use an allowlisted provider wallet to register a service.",
  ENDPOINT_VERIFICATION_FAILED: "The endpoint did not return a matching signed probe. Check the service manifest and provider configuration.",
  ONCHAIN_SERVICE_TERMS_MISMATCH: "The manifest differs from the registered onchain price version. Use the exact registered terms.",
  REQUEST_STATUS_TIMEOUT: "The request is still unresolved. Its identity and reservation are retained. Check its receipt or retry the same request.",
  SOFT_LIMIT_OVERRIDE_REQUIRED: "This request crosses the soft limit. Review and sign a customer approval for its exact cumulative cap.",
  GATEWAY_OPERATION_FAILED: "The gateway could not complete this operation. Check its status and retry.",
  NOT_SESSION_CUSTOMER: "Use the wallet that owns this session.",
  UNKNOWN_REQUEST: "No request was found for this wallet. Check the request ID and connected account.",
  GATEWAY_UNAVAILABLE: "The gateway is unavailable. Start it or check the configured gateway URL, then retry.",
  INVALID_PUBLIC_CONFIGURATION: "The public gateway and RPC configuration must use HTTPS or a local loopback address.",
  TRANSACTION_REVERTED: "The transaction reverted. No successful state change was confirmed. Refresh the account before trying again.",
  PENDING_NETWORK_CHANGED: "This pending transaction belongs to another network. Restore its recorded RPC before checking it.",
  TRANSACTION_BINDING_MISMATCH: "This transaction does not match the retained wallet action. Check the hash in your wallet.",
  INVALID_JSON_INPUT: "Enter valid JSON for both the document and its schema.",
  OVERRIDE_CAP_MISMATCH: "The session’s cumulative spend changed. Review the current total and approve again.",
  WALLET_SESSION_CHANGED: "The account or network changed during this action. Connect again before continuing."
};
export function errorMessage(error: unknown) {
  const code = error instanceof EmeterGatewayError ? error.code : error instanceof Error ? error.message : "";
  if (messages[code]) return messages[code];
  if (walletRejected(error)) return "The wallet request was declined. You can try again when ready.";
  if (walletErrorCode(error) === -32002) return messages.WALLET_REQUEST_PENDING!;
  if (/fetch|network|timeout|Failed to|ECONN|ENOTFOUND/i.test(code)) return messages.GATEWAY_UNAVAILABLE!;
  if (/soft.limit/i.test(code)) return messages.SOFT_LIMIT_OVERRIDE_REQUIRED!;
  if (/RefundLocked/i.test(code)) return "The original settlement window is still open. Wait until the refund time shown for this session.";
  if (/authorization|signature|verification|canonical|match|manifest/i.test(code)) return "Evidence could not be verified. Refresh and inspect the signed request before taking another action.";
  return code && code.length < 180 ? code : "The operation could not be completed. Refresh the current state and try again.";
}
