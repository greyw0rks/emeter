"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useGateway } from "./gateway-provider";
import { Button, Dialog, Field } from "./ui";
import { demo } from "../lib/models";

export function CreditDialog({ action, onClose }: { action: "deposit" | "withdraw" | null; onClose: () => void }) {
  const gateway = useGateway(), [amount, setAmount] = useState("1");
  return <Dialog open={Boolean(action)} onClose={onClose} title={action === "withdraw" ? "Withdraw available credit" : "Deposit credit"}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      void (action === "withdraw" ? gateway.withdraw(amount) : gateway.deposit(amount)).then(onClose).catch(() => undefined);
    }}><p className="form-note">{action === "withdraw" ? "Move unused available credit back to your wallet. Session balances must be refunded to available credit first."
      : "Deposit DEMO from your wallet into the session vault. A needed token approval is limited to this exact deposit amount."}</p>
      <Field label="Amount (DEMO)" hint={`${action === "withdraw" ? "Available credit" : "Wallet DEMO"}: ${demo(action === "withdraw" ? gateway.account?.availableBaseUnits ?? "0" : gateway.account?.demoBalanceBaseUnits ?? "0")}`}>
        <input name="creditAmount" value={amount} disabled={Boolean(gateway.busy || gateway.pending)} onChange={event => setAmount(event.target.value)} inputMode="decimal" required autoComplete="off" /></Field>
      <p className="form-note">{gateway.network?.networkMode === "local-fork" ? "This transaction is on the local fork. " : ""}DEMO is a test token. Your wallet also needs OKB for gas.</p>
      <div className="actions"><Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={Boolean(gateway.busy || gateway.pending) || !gateway.signedIn}>{action === "withdraw" ? "Withdraw to wallet" : "Approve and deposit"}</Button></div>
    </form>
  </Dialog>;
}
export function SessionDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: Hex) => void }) {
  const gateway = useGateway();
  const [budget, setBudget] = useState("0.5"), [soft, setSoft] = useState("0.1"), [maximum, setMaximum] = useState("0.05");
  const [minutes, setMinutes] = useState(15), [selected, setSelected] = useState<Hex[]>([]);
  useEffect(() => { if (open) setSelected(gateway.services.map(service => service.id)); }, [open]);
  return <Dialog open={open} onClose={onClose} title="Authorize a spending session"><form className="form-stack" onSubmit={event => {
    event.preventDefault(); void gateway.createSession({ budget, softLimit: soft, maxCharge: maximum, minutes, serviceIds: selected })
      .then(id => { onCreated?.(id); onClose(); }).catch(() => undefined);
  }}><p className="form-note">A session reserves a hard budget from your available credit. Its delegated signer can charge only the services and limits you approve.</p>
    <div className="form-grid"><Field label="Hard budget (DEMO)" hint={`Available credit: ${demo(gateway.account?.availableBaseUnits ?? "0")} DEMO`}>
      <input name="hardBudget" value={budget} disabled={Boolean(gateway.busy || gateway.pending)} inputMode="decimal" onChange={event => setBudget(event.target.value)} required autoComplete="off" /></Field>
      <Field label="Soft limit (DEMO)" hint="Crossing this requires a customer approval."><input name="softLimit" value={soft} disabled={Boolean(gateway.busy || gateway.pending)} inputMode="decimal" onChange={event => setSoft(event.target.value)} required autoComplete="off" /></Field>
      <Field label="Per-request maximum (DEMO)"><input name="maxCharge" value={maximum} disabled={Boolean(gateway.busy || gateway.pending)} inputMode="decimal" onChange={event => setMaximum(event.target.value)} required autoComplete="off" /></Field>
      <Field label="Execution duration"><select value={minutes} disabled={Boolean(gateway.busy || gateway.pending)} onChange={event => setMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={1440}>24 hours</option></select></Field></div>
    <fieldset><legend>Allowed services</legend>{gateway.services.length ? gateway.services.map(service => <label className="checkbox-row" key={service.id}>
      <input type="checkbox" checked={selected.includes(service.id)} disabled={Boolean(gateway.busy || gateway.pending)} onChange={event => setSelected(previous => event.target.checked ? [...previous, service.id] : previous.filter(id => id !== service.id))} />
      <span>{service.name}<small>{demo(service.priceBaseUnits)} DEMO / request · price v{service.priceVersion}</small></span></label>) : <p className="form-note">No verified service is available. Refresh the catalog after the provider is registered.</p>}</fieldset>
    <p className="form-note">The signing key stays in this tab. Closing stops new execution; the original two-minute settlement window stays open before unused credit can be refunded.</p>
    <div className="actions"><Button variant="secondary" onClick={onClose} disabled={Boolean(gateway.busy)}>Cancel</Button>
      <Button type="submit" disabled={Boolean(gateway.busy || gateway.pending) || !selected.length || !gateway.signedIn}>Sign limits and create session</Button></div>
  </form></Dialog>;
}
