"use client";

import Link from "next/link";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowRight, Check, Copy, LoaderCircle, Wallet, X } from "lucide-react";
import { useGateway } from "./gateway-provider";
import { demo, short, time } from "../lib/models";
import type { Activity } from "../lib/models";

export function Button({ children, variant = "primary", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}
export function ActionLink({ href, children, secondary = false }: { href: string; children: ReactNode; secondary?: boolean }) {
  return <Link className={`button button-${secondary ? "secondary" : "primary"}`} href={href}>{children}<ArrowRight size={16} aria-hidden="true" /></Link>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "mint" | "lime" | "red" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
const requestLabels = { authorized: "Authorized", processing: "Processing", completed: "Result ready", failed: "Failed", indeterminate: "Unresolved" };
const paymentLabels = { unsubmitted: "Not submitted", pending: "Pending", settled: "Confirmed", denied: "Denied", failed: "Failed" };
export function RequestBadge({ status }: { status: Activity["requestStatus"] }) {
  return <Badge tone={status === "completed" ? "mint" : status === "failed" ? "red" : status === "indeterminate" ? "lime" : "neutral"}>{requestLabels[status]}</Badge>;
}
export function PaymentBadge({ status }: { status: Activity["paymentStatus"] }) {
  return <Badge tone={status === "settled" ? "mint" : status === "denied" || status === "failed" ? "red" : "neutral"}>{paymentLabels[status]}</Badge>;
}
export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="actions">{actions}</div>}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const generated = useId();
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children) ? children : undefined;
  const id = control?.props.id ?? generated, hintId = generated + "-hint";
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label>
    {control ? cloneElement(control, { id, ...(hint ? { "aria-describedby": [control.props["aria-describedby"], hintId].filter(Boolean).join(" ") } : {}) }) : children}
    {hint && <span className="field-hint" id={hintId}>{hint}</span>}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3><p>{children}</p>{action && <div className="actions">{action}</div>}</div>;
}
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const { busy, error } = useGateway();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal(); element.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault(); if (!busy) onClose();
  }} onClick={event => { if (event.target === ref.current && !busy) onClose(); }}>
    <div className="dialog-content"><div className="dialog-heading"><h2 id={titleId}>{title}</h2>
      <Button variant="quiet" aria-label="Close dialog" disabled={Boolean(busy)} onClick={onClose}><X size={18} /></Button></div>
      {children}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {busy && <p className="loading-copy" role="status"><LoaderCircle size={16} className="spinner" aria-hidden="true" />{busy}…</p>}
    </div>
  </dialog>;
}
export function CopyValue({ value, truncate = false, label = "Copy value" }: { value: string; truncate?: boolean; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => { if (state !== "idle") { const timer = setTimeout(() => setState("idle"), 1800); return () => clearTimeout(timer); } }, [state]);
  return <span className="copy-value"><code title={truncate ? value : undefined}>{truncate ? short(value, 10, 6) : value}</code>
    <button type="button" className="icon-button" aria-label={label} onClick={() => {
      void navigator.clipboard.writeText(value).then(() => setState("copied")).catch(() => setState("error"));
    }}>{state === "copied" ? <Check size={15} /> : <Copy size={15} />}</button>
    <span className="sr-only" role="status">{state === "copied" ? "Copied" : state === "error" ? "Clipboard unavailable; select and copy the value." : ""}</span>
  </span>;
}
export function WalletButton() {
  const gateway = useGateway();
  if (!gateway.signedIn) return <Button variant="secondary" disabled={Boolean(gateway.busy) || gateway.loading || !gateway.config}
    onClick={() => { void gateway.connect().catch(() => undefined); }}><Wallet size={16} aria-hidden="true" />{gateway.address ? "Sign in" : "Connect wallet"}</Button>;
  return <details className="wallet-menu"><summary className="button button-secondary"><Wallet size={16} aria-hidden="true" />{short(gateway.address!)}</summary>
    <div className="wallet-popover"><p>Signed in wallet</p><CopyValue value={gateway.address!} truncate label="Copy wallet address" />
      <Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={gateway.disconnect}>Disconnect</Button></div></details>;
}
export function NetworkBadge() {
  const { network, loading, refreshedAt, reachable } = useGateway();
  return <span className="network-badge"><span className={`status-dot ${reachable && network?.paidExecutionReady ? "status-on" : ""}`} aria-hidden="true" />
    {network && reachable ? network.networkMode === "local-fork" ? "Local fork" : "X Layer" : loading ? "Connecting" : "Gateway offline"}
    {network && reachable && <span className="network-readiness">{network.paidExecutionReady ? "Ready" : "Preparing"}</span>}
    {refreshedAt && <span className="sr-only">Last read {time(refreshedAt)}</span>}
  </span>;
}
export function WalletGate({ children }: { children: ReactNode }) {
  const { signedIn, loading } = useGateway();
  if (signedIn) return children;
  return <div className="wallet-gate"><EmptyState title={loading ? "Checking the gateway" : "Connect to see your workspace"} action={!loading && <WalletButton />}>
    {loading ? "Reading the configured gateway and deployed contracts." : "Sign a wallet login to see your credit, sessions, and request history. Spending requires a separate authorization."}
  </EmptyState></div>;
}
export function GlobalFeedback() {
  const gateway = useGateway();
  const [recoveryHash, setRecoveryHash] = useState("");
  return <div className="feedback-stack">
    {gateway.error && <div role="alert" className="feedback feedback-error"><span>{gateway.error}</span>
      <Button variant="quiet" aria-label="Dismiss message" onClick={gateway.clearError}><X size={16} /></Button></div>}
    {gateway.notice && <p role="status" className="feedback feedback-notice">{gateway.notice}</p>}
    {gateway.busy && <p role="status" className="feedback feedback-progress"><LoaderCircle size={16} className="spinner" aria-hidden="true" />{gateway.busy}…</p>}
    {gateway.pending && !gateway.busy && <div className="pending-banner" role="status"><div><strong>{gateway.pending.label} needs confirmation</strong>
      <p>{gateway.pending.mode === "local-fork" ? "Local fork transaction." : "X Layer transaction."} Confirm its result before another wallet transaction.</p>
      {gateway.pending.hash ? <CopyValue value={gateway.pending.hash} truncate label="Copy pending transaction hash" />
        : <Field label="Transaction hash from your wallet"><input value={recoveryHash} onChange={event => setRecoveryHash(event.target.value)} placeholder="0x…" /></Field>}</div>
      <Button variant="secondary" onClick={() => { void gateway.checkPending(recoveryHash || undefined).catch(() => undefined); }}>Check transaction</Button>
    </div>}
  </div>;
}
export function ActivityTable({ requests }: { requests: Activity[] }) {
  if (!requests.length) return <EmptyState title="No requests yet" action={<ActionLink href="/playground">Run your first request</ActionLink>}>
    Your requests and their payment confirmations will appear here.</EmptyState>;
  return <div className="table-scroll" tabIndex={0} aria-label="Request activity"><table className="data-table"><thead><tr>
    <th scope="col">Request / service</th><th scope="col">Execution</th><th scope="col">Payment</th><th scope="col" className="align-right">DEMO</th><th scope="col">Created</th>
  </tr></thead><tbody>{requests.map(request => <tr key={request.requestId}><td><Link className="table-link" href={`/receipts/${request.requestId}`}>{request.serviceName}<ArrowRight size={13} aria-hidden="true" /></Link>
    <code className="muted">{short(request.requestId, 10, 6)}</code></td><td><RequestBadge status={request.requestStatus} /></td><td><PaymentBadge status={request.paymentStatus} /></td>
    <td className="mono align-right">{demo(request.priceBaseUnits)}</td><td className="muted nowrap">{time(request.createdAt)}</td></tr>)}</tbody></table></div>;
}
