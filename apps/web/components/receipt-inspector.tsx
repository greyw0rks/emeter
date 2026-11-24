"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import type { EmeterResult } from "@emeter/sdk";
import { RefreshCw } from "lucide-react";
import { useGateway } from "./gateway-provider";
import { ReceiptDetails } from "./receipt-details";
import { Circuit, PolicyOutput } from "./circuit";
import { Button, Dialog, EmptyState, PageHeader, WalletGate } from "./ui";
import { paymentAmount } from "../lib/models";
import { errorMessage } from "../lib/errors";

export function ReceiptInspector({ id }: { id: Hex }) {
  const gateway = useGateway();
  const [record, setRecord] = useState<EmeterResult>(), [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const load = async (initial = true) => {
    if (initial) setLoading(true);
    try { setRecord(await gateway.verifyRequest(id)); setError(undefined); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let cancelled = false; setRecord(undefined); setError(undefined);
    if (gateway.signedIn) {
      setLoading(true);
      void gateway.verifyRequest(id).then(value => { if (!cancelled) setRecord(value); }).catch(failure => { if (!cancelled) setError(errorMessage(failure)); }).finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [id, gateway.signedIn, gateway.address]);
  useEffect(() => {
    if (!record || record.paymentStatus === "settled" || record.paymentStatus === "denied" || record.requestStatus === "failed") return;
    const timer = setInterval(() => { void load(false); }, 3000); return () => clearInterval(timer);
  }, [record?.paymentStatus, record?.requestStatus, id, gateway.signedIn]);
  const mask = record?.transaction?.policyInputs ?? record?.policyInputs;
  const session = gateway.account?.sessions.find(value => value.sessionId === record?.sessionId);
  const cumulative = BigInt(session?.spent ?? "0") + BigInt(record?.priceBaseUnits ?? "0");
  const overrideAvailable = record?.receiptVerified && record.paymentStatus === "denied" && mask === 15 && session;
  return <><PageHeader title="Receipt inspector" description="Independently check the signed result, original price terms, and canonical payment." actions={<Button variant="secondary"
    disabled={!gateway.signedIn || loading || Boolean(gateway.busy)} onClick={() => { void load(); }}><RefreshCw size={15} aria-hidden="true" />Verify again</Button>} />
    <WalletGate>{loading && !record ? <p className="loading-copy">Checking request bindings, signatures, and chain evidence…</p> : error ? <EmptyState title="Receipt could not be verified" action={<Button variant="secondary" onClick={() => { void load(); }}>Retry verification</Button>}>{error}</EmptyState>
      : record ? <><ReceiptDetails record={record} />
        {record.requestStatus === "indeterminate" && <div className="section form-stack"><p className="form-note">Completion is unresolved. The request’s reservation remains until its retained evidence is recovered or it expires.</p>
          <div className="actions"><Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => { void gateway.recoverRequest(id).then(() => load()).catch(() => undefined); }}>Recover retained request</Button></div></div>}
        {overrideAvailable && <div className="section"><p className="form-note">The signed result is available, but the policy denied payment at the soft limit.</p><div className="actions section">
          <Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => { gateway.clearError(); setOverrideOpen(true); }}>Review customer approval</Button></div></div>}
        <section className="section"><div className="section-heading"><h2>Recorded policy evaluation</h2><Link className="text-link" href="/policy">Explore the conditions</Link></div>
          {typeof mask === "number" ? <><Circuit mask={mask} source={record.settlementVerified ? "Canonical settlement inputs" : "Gateway-recorded inputs · payment unconfirmed"} /><PolicyOutput mask={mask} /></>
            : <EmptyState title="Policy has not been evaluated">No policy input mask is recorded for this request yet.</EmptyState>}</section>
      </> : <p className="form-note">The receipt will appear after verification.</p>}</WalletGate>
    <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Approve this request’s settlement"><div className="form-stack"><p>Approve a cumulative session cap of <strong className="mono lime">{paymentAmount(cumulative)} {gateway.currency}</strong> for this retained request.</p>
      <p className="form-note">The service output stays the same. This signs a customer override and requeues its existing settlement; it creates no new request.</p><div className="actions">
        <Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => setOverrideOpen(false)}>Cancel</Button><Button disabled={Boolean(gateway.busy) || !session} onClick={() => {
          void gateway.approveSettlement(id, cumulative).then(() => { setOverrideOpen(false); return load(); }).catch(() => undefined);
        }}>Sign {paymentAmount(cumulative)} {gateway.currency} cap</Button></div></div></Dialog>
  </>;
}
