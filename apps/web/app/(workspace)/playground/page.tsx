"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { Hex } from "viem";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { parseStrictJson } from "@emeter/shared";
import type { JsonValue } from "@emeter/shared";
import { useGateway } from "../../../components/gateway-provider";
import { SessionDialog } from "../../../components/session-forms";
import { ReceiptDetails } from "../../../components/receipt-details";
import { ActionLink, Badge, Button, CopyValue, Dialog, EmptyState, Field, PageHeader, WalletGate } from "../../../components/ui";
import { canExecute, paymentAmount, short } from "../../../lib/models";

function Playground() {
  const gateway = useGateway(), query = useSearchParams();
  const [serviceId, setServiceId] = useState(gateway.execution?.serviceId ?? query.get("service") ?? ""), [sessionId, setSessionId] = useState(gateway.execution?.sessionId ?? "");
  const [maximum, setMaximum] = useState(gateway.execution?.record ? formatUnits(BigInt(gateway.execution.record.authorization.maxAmount), 6) : "0.05"), [document, setDocument] = useState('{\n  "name": "Ada"\n}');
  const [schema, setSchema] = useState('{\n  "type": "object",\n  "required": ["name"],\n  "properties": { "name": { "type": "string" } },\n  "additionalProperties": false\n}');
  const [text, setText] = useState("Explain how bounded API payments protect an agent’s spending budget.");
  const [schemaEnabled, setSchemaEnabled] = useState(true), [sessionOpen, setSessionOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false), [approved, setApproved] = useState(false), [localError, setLocalError] = useState<string>();
  const [preparedInput, setPreparedInput] = useState<JsonValue>();
  const service = gateway.services.find(value => value.id === serviceId);
  const sessions = gateway.account?.sessions.filter(session => canExecute(session, gateway.network?.anchor?.timestamp) && session.serviceIds.includes(serviceId as Hex)) ?? [];
  const session = sessions.find(value => value.sessionId === sessionId);
  const quote = BigInt(service?.priceBaseUnits ?? "0"), cumulative = BigInt(session?.spent ?? "0") + BigInt(session?.reservedBaseUnits ?? "0") + quote;
  const needsOverride = Boolean(session && cumulative > BigInt(session.softLimit));
  const locked = Boolean(gateway.busy || gateway.execution);
  useEffect(() => { setApproved(false); }, [cumulative]);
  useEffect(() => { if (!serviceId && gateway.services[0]) setServiceId(gateway.services[0].id); }, [gateway.services, serviceId]);
  useEffect(() => { if (service && !gateway.execution) setMaximum(formatUnits(BigInt(service.priceBaseUnits), 6)); }, [service?.id, service?.priceVersion]);
  useEffect(() => {
    if (!sessionId && sessions.length) setSessionId((sessions.find(value => gateway.hasSessionKey(value.sessionId)) ?? sessions[0])!.sessionId);
  }, [gateway.account, serviceId, sessionId]);
  useEffect(() => {
    if (overrideOpen && gateway.execution?.record) setOverrideOpen(false);
  }, [gateway.execution?.record, overrideOpen]);
  const run = (input: JsonValue, override?: bigint) => {
    if (!service || !session) return;
    void gateway.execute({ sessionId: session.sessionId, serviceId: service.id, priceVersion: service.priceVersion, input, maxCharge: maximum,
      ...(override !== undefined ? { maximumTotalSpend: override } : {}) }).then(() => setOverrideOpen(false)).catch(() => undefined);
  };
  return <><PageHeader title="Playground" description="Run a real service with signed limits. Inspect the output and its payment separately." actions={<Button variant="secondary"
    disabled={!gateway.signedIn || Boolean(gateway.busy || gateway.pending)} onClick={() => { gateway.clearError(); setSessionOpen(true); }}>New session</Button>} />
    <WalletGate>{!gateway.services.length ? <EmptyState title="A verified service is needed" action={<ActionLink href="/services" secondary>View services</ActionLink>}>The gateway catalog has no active verified endpoint. Start the provider or register a service.</EmptyState> : <>
      <div className="selection-grid"><Field label="Service"><select value={serviceId} disabled={locked} onChange={event => { setServiceId(event.target.value); setSessionId(""); }}>
        {gateway.services.map(value => <option key={value.id} value={value.id}>{value.name} · {paymentAmount(value.priceBaseUnits)} {gateway.currency}</option>)}</select></Field>
        <Field label="Spending session"><select value={sessionId} disabled={locked} onChange={event => setSessionId(event.target.value)}><option value="">Select an active session</option>
          {sessions.map(value => <option key={value.sessionId} value={value.sessionId}>{short(value.sessionId, 10, 6)} · {paymentAmount(value.balance)} {gateway.currency} left{gateway.hasSessionKey(value.sessionId) ? " · key in tab" : " · key unavailable"}</option>)}</select></Field></div>
      {session ? <div className="budget-context"><span>Hard budget <strong className="mono">{paymentAmount(session.budget)} {gateway.currency}</strong></span><span>Spent <strong className="mono">{paymentAmount(session.spent)} {gateway.currency}</strong></span>
        <span>Soft limit <strong className="mono">{paymentAmount(session.softLimit)} {gateway.currency}</strong></span><span>Reserved <strong className="mono">{paymentAmount(session.reservedBaseUnits)} {gateway.currency}</strong></span></div>
        : <p className="form-note budget-context">Create a session that allows this service, then select it here. <Link className="text-link" href="/dashboard">Fund credit in Overview<ArrowRight size={13} aria-hidden="true" /></Link></p>}
      {session && !gateway.hasSessionKey(session.sessionId) && <p className="feedback feedback-notice">This tab does not have the session key. Create a new session here, or close and refund the existing session from Overview.</p>}
      <form onSubmit={event => {
        event.preventDefault(); setLocalError(undefined);
        try {
          const input: JsonValue = service?.method === "json_validate" ? { json: document, ...(schemaEnabled ? { schema: parseStrictJson(schema) } : {}) }
            : service?.method === "text_analyze" ? { text } : parseStrictJson(document);
          if (needsOverride) { setPreparedInput(input); setApproved(false); gateway.clearError(); setOverrideOpen(true); } else run(input);
        } catch { setLocalError("The schema or service parameters are not valid JSON. Correct them before running the request."); }
      }}>
        {service?.method === "json_validate" ? <div className="split-layout"><div className="editor-panel"><label className="editor-toolbar" htmlFor="json-document"><span>JSON document</span><code>input.json</code></label>
          <textarea id="json-document" value={document} onChange={event => setDocument(event.target.value)} disabled={locked} required spellCheck={false} /></div>
          <div className="editor-panel"><div className="editor-toolbar"><label htmlFor="json-schema">JSON Schema</label><label className="checkbox-row"><input type="checkbox" checked={schemaEnabled} disabled={locked} onChange={event => setSchemaEnabled(event.target.checked)} />Enabled</label></div>
            <textarea id="json-schema" value={schema} onChange={event => setSchema(event.target.value)} disabled={locked || !schemaEnabled} spellCheck={false} /></div></div>
          : <div className="editor-panel"><label className="editor-toolbar" htmlFor="service-input"><span>{service?.method === "text_analyze" ? "Text to analyze" : "Service parameters JSON"}</span><code>{service?.method}</code></label>
            <textarea id="service-input" value={service?.method === "text_analyze" ? text : document} maxLength={service?.method === "text_analyze" ? 8000 : 65_536}
              onChange={event => service?.method === "text_analyze" ? setText(event.target.value) : setDocument(event.target.value)} disabled={locked} required spellCheck={false} /></div>}
        <div className="run-controls"><Field label={`Request maximum (${gateway.currency})`} hint={session ? `Signed maximum: ${paymentAmount(session.maxCharge)} ${gateway.currency} · price v${service?.priceVersion}` : "Select a signed session first."}>
          <input value={maximum} inputMode="decimal" onChange={event => setMaximum(event.target.value)} disabled={locked} required autoComplete="off" /></Field>
          <div className="actions">{needsOverride && <Badge tone="lime">Customer approval required</Badge>}<Button type="submit" disabled={locked || Boolean(gateway.pending)
            || !gateway.network?.paidExecutionReady || !service || !session || !gateway.hasSessionKey(session.sessionId)}><Play size={15} aria-hidden="true" />{needsOverride ? "Review approval and run" : "Run request"}</Button></div></div>
        {localError && <p role="alert" className="inline-error">{localError}</p>}
        <p className="form-note section">The signed maximum bounds this request; the fixed service price is charged only if settlement succeeds. A retry retains the same request ID and authorization.</p>
      </form>
    </>}</WalletGate>
    {gateway.execution && <section className="result-panel" aria-live="polite"><div className="section-heading"><h2>Request lifecycle</h2>
      <Link className="text-link" href={`/receipts/${gateway.execution.requestId}`}>Inspect receipt<ArrowRight size={15} aria-hidden="true" /></Link></div>
      <p className="form-note">Request <CopyValue value={gateway.execution.requestId} truncate label="Copy playground request ID" /></p>
      {gateway.execution.record ? <div className="section"><ReceiptDetails record={gateway.execution.record} compact /></div> : <p className="loading-copy">{gateway.execution.phase === "authorizing" ? "Preparing this request’s authorization…" : "Checking the retained request…"}</p>}
      {gateway.execution.error && <p className="inline-error">{gateway.execution.error}</p>}
      <div className="actions section">{gateway.execution.phase === "unresolved" && <Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => { void gateway.recoverExecution().catch(() => undefined); }}><RotateCcw size={15} aria-hidden="true" />Recover the same request</Button>}
        {gateway.execution.phase === "finished" && <Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={gateway.clearExecution}>Start a new request</Button>}</div>
    </section>}
    <SessionDialog open={sessionOpen} onClose={() => setSessionOpen(false)} onCreated={id => setSessionId(id)} />
    <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Approve crossing the soft limit"><div className="form-stack">
      <p>This request takes the session above its soft limit. Your wallet must sign a separate approval for this exact cumulative cap.</p>
      <dl className="evidence-list"><div><dt>Request price</dt><dd className="mono">{paymentAmount(quote)} {gateway.currency}</dd></div><div><dt>Already spent</dt><dd className="mono">{paymentAmount(session?.spent ?? "0")} {gateway.currency}</dd></div>
        <div><dt>Reserved requests</dt><dd className="mono">{paymentAmount(session?.reservedBaseUnits ?? "0")} {gateway.currency}</dd></div><div><dt>Approved total cap</dt><dd className="mono lime">{paymentAmount(cumulative)} {gateway.currency}</dd></div><div><dt>Hard budget</dt><dd className="mono">{paymentAmount(session?.budget ?? "0")} {gateway.currency}</dd></div></dl>
      <label className="checkbox-row"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} disabled={Boolean(gateway.busy)} />I approve a cumulative cap of {paymentAmount(cumulative)} {gateway.currency} for this session.</label>
      <div className="actions"><Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => setOverrideOpen(false)}>Cancel</Button>
        <Button disabled={!approved || Boolean(gateway.busy) || preparedInput === undefined} onClick={() => { if (preparedInput !== undefined) run(preparedInput, cumulative); }}>Sign approval and run</Button></div>
    </div></Dialog>
  </>;
}
export default function PlaygroundPage() { return <Suspense fallback={<p className="loading-copy">Loading playground…</p>}><Playground /></Suspense>; }
