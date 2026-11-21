"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUnits } from "viem";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { useGateway } from "../../../components/gateway-provider";
import { CreditDialog, SessionDialog } from "../../../components/session-forms";
import { ActionLink, ActivityTable, Badge, Button, CopyValue, Dialog, PageHeader, WalletGate } from "../../../components/ui";
import { chainTime, demo, sessionState, short } from "../../../lib/models";
import type { SpendingSession } from "../../../lib/models";

export default function Dashboard() {
  const gateway = useGateway();
  const [creditAction, setCreditAction] = useState<"deposit" | "withdraw" | null>(null), [sessionOpen, setSessionOpen] = useState(false);
  const [manage, setManage] = useState<{ session: SpendingSession; action: "closeSession" | "revokeSessionSigner" | "refund" } | null>(null);
  const account = gateway.account;
  const unavailable = Boolean(gateway.busy || gateway.pending);
  return <><PageHeader title="Overview" description="Your credit, spending permissions, and the requests they fund." actions={<>
    <Button variant="quiet" aria-label="Refresh account" onClick={() => { void gateway.refresh(); }} disabled={Boolean(gateway.busy)}><RefreshCw size={16} /></Button>
    <Button disabled={!gateway.signedIn || unavailable} onClick={() => { gateway.clearError(); setCreditAction("deposit"); }}><Plus size={16} aria-hidden="true" />Deposit credit</Button></>} />
    <WalletGate>{account ? <>
      <dl className="summary-strip"><div className="summary-item"><dt>Available credit</dt><dd className="mono">{demo(account.availableBaseUnits)}<small>DEMO</small></dd><p>Ready for a new session</p></div>
        <div className="summary-item"><dt>Recent session balances</dt><dd className="mono">{demo(account.lockedBaseUnits)}<small>DEMO</small></dd><p>Live balances of shown sessions</p></div>
        <div className="summary-item"><dt>Confirmed spend</dt><dd className="mono">{demo(account.stats.confirmedBaseUnits)}<small>DEMO</small></dd><p>{account.stats.confirmedRequests} confirmed payments</p></div>
        <div className="summary-item"><dt>Request reservations</dt><dd className="mono">{demo(account.stats.reservedBaseUnits)}<small>DEMO</small></dd><p>Pending or unresolved payment</p></div></dl>
      {account.stats.totalRequests === 0 && <div className="setup-flow"><div><h3>Fund your next request</h3><p>Your wallet holds {demo(account.demoBalanceBaseUnits)} DEMO. Deposit credit to create a spending session.</p>
        <Button variant="secondary" disabled={unavailable} onClick={() => { gateway.clearError(); setCreditAction("deposit"); }}>Deposit DEMO</Button></div>
        <div><h3>Set a bounded session</h3><p>Choose a budget, service scope, and expiry. Approve the limits with your wallet.</p>
          <Button variant="secondary" disabled={unavailable || !gateway.services.length} onClick={() => { gateway.clearError(); setSessionOpen(true); }}>Authorize a session</Button></div>
        <div><h3>Execute and inspect</h3><p>The playground connects your signed session to an actual verified service.</p><ActionLink href="/playground" secondary>Open playground</ActionLink></div></div>}
      <section className="section"><div className="section-heading"><div><h2>Spending sessions</h2><p>{account.sessions.length ? `${account.sessions.length} recent sessions · keys belong to the tab that created them` : "Authorize a session to reserve credit and run requests."}</p></div>
        <Button variant="secondary" disabled={unavailable || !gateway.services.length} onClick={() => { gateway.clearError(); setSessionOpen(true); }}><Plus size={15} aria-hidden="true" />New session</Button></div>
        <div className="session-list">{account.sessions.map(session => {
          const state = sessionState(session, gateway.network?.anchor?.timestamp), hasKey = gateway.hasSessionKey(session.sessionId);
          const refundable = session.status !== 3 && gateway.network?.anchor && BigInt(gateway.network.anchor.timestamp) > BigInt(session.refundAfter);
          return <div className="session-row" key={session.sessionId}><div><div className="session-title"><CopyValue value={session.sessionId} truncate label="Copy session ID" />
            <Badge tone={state === "Active" ? "mint" : "neutral"}>{state}</Badge></div><p>{session.serviceIds.length} allowed services · {hasKey ? "Key in this tab" : "Key unavailable in this tab"}</p></div>
            <div><div className="session-budget mono">{demo(session.balance)} <small>DEMO left</small></div><p>{demo(session.spent)} / {demo(session.budget)} spent · soft {demo(session.softLimit)}</p></div>
            <div><p>Execution until {chainTime(session.executionDeadline)}</p><p>Refund after {chainTime(session.refundAfter)}</p></div>
            <div className="actions">{session.status === 1 && <Button variant="secondary" disabled={unavailable} onClick={() => { gateway.clearError(); setManage({ session, action: "closeSession" }); }}>Close</Button>}
              {!session.signerRevoked && session.status !== 3 && <Button variant="quiet" disabled={unavailable} onClick={() => { gateway.clearError(); setManage({ session, action: "revokeSessionSigner" }); }}>Revoke signer</Button>}
              {session.status !== 3 && <Button variant="secondary" disabled={unavailable || !refundable} onClick={() => { gateway.clearError(); setManage({ session, action: "refund" }); }}>Refund</Button>}</div>
          </div>;
        })}</div>
      </section>
      <section className="section"><div className="section-heading"><div><h2>Recent requests</h2><p>{account.stats.totalRequests ? `Latest ${account.requests.length} of ${account.stats.totalRequests} requests. Execution and payment are tracked separately.` : "Signed results and confirmed payments appear separately."}</p></div>
        <Link className="text-link" href="/receipts">Inspect a receipt<ArrowRight size={15} aria-hidden="true" /></Link></div><ActivityTable requests={account.requests} /></section>
      <section className="section"><div className="section-heading"><div><h2>Wallet and credit</h2><p>{demo(account.demoBalanceBaseUnits)} DEMO in wallet · gas balance is {formatUnits(BigInt(account.nativeBalanceWei), 18)} OKB</p></div>
        <Button variant="secondary" disabled={unavailable || BigInt(account.availableBaseUnits) === 0n} onClick={() => { gateway.clearError(); setCreditAction("withdraw"); }}>Withdraw available credit</Button></div></section>
    </> : <p className="loading-copy">Reading your account from the gateway and chain…</p>}</WalletGate>
    <details className="network-details"><summary>Gateway and network details</summary><p>Gateway: <code>{gateway.config?.gatewayUrl ?? "Not configured"}</code></p>
      <p>Browser RPC: <code>{gateway.config?.rpcUrl ?? "X Layer mainnet RPC (default)"}</code></p>
      <p>{gateway.network?.networkMode === "local-fork" ? "Set your wallet to this exact local fork RPC. Chain ID 196 alone does not distinguish it from mainnet." : "The wallet’s block hash is checked against the gateway before every signature and transaction."}</p></details>
    <CreditDialog action={creditAction} onClose={() => setCreditAction(null)} /><SessionDialog open={sessionOpen} onClose={() => setSessionOpen(false)} />
    <Dialog open={Boolean(manage)} onClose={() => setManage(null)} title={manage?.action === "refund" ? "Refund session credit" : manage?.action === "revokeSessionSigner" ? "Revoke the delegated signer" : "Close spending session"}>
      {manage && <div className="form-stack"><p className="form-note">Session <code>{short(manage.session.sessionId, 12, 8)}</code></p>
        <p>{manage.action === "refund" ? `${demo(manage.session.balance)} DEMO returns to your available credit, using the current chain balance.`
          : manage.action === "closeSession" ? "Stop new requests. Previously authorized requests can still settle until the original refund window closes."
            : "Disable the session signer and stop its future charges. This tab’s key is cleared. The original refund window remains in force."}</p>
        <div className="actions"><Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => setManage(null)}>Cancel</Button>
          <Button variant={manage.action === "refund" ? "primary" : "danger"} disabled={unavailable} onClick={() => {
            void gateway.manageSession(manage.session.sessionId, manage.action).then(() => setManage(null)).catch(() => undefined);
          }}>{manage.action === "refund" ? "Refund unused credit" : manage.action === "closeSession" ? "Close this session" : "Revoke this signer"}</Button></div></div>}
    </Dialog>
  </>;
}
