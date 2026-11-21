"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Braces, Brain, RefreshCw } from "lucide-react";
import { ServiceManifestSchema, parseStrictJson } from "@emeter/shared";
import type { z } from "zod";
import { useGateway } from "../../../components/gateway-provider";
import { Credentials } from "../../../components/credentials";
import { Badge, Button, EmptyState, Field, PageHeader, PaymentBadge, RequestBadge, WalletGate } from "../../../components/ui";
import { demo, short, time, UsageSchema } from "../../../lib/models";
import { errorMessage } from "../../../lib/errors";

export default function Services() {
  const gateway = useGateway();
  const [tab, setTab] = useState<"browse" | "manage">("browse"), [manifest, setManifest] = useState("");
  const [localError, setLocalError] = useState<string>(), [usage, setUsage] = useState<z.infer<typeof UsageSchema>>();
  useEffect(() => {
    let cancelled = false;
    if (tab === "manage" && gateway.signedIn) void gateway.getUsage().then(value => { if (!cancelled) setUsage(value); }).catch(failure => { if (!cancelled) setLocalError(errorMessage(failure)); });
    else setUsage(undefined);
    return () => { cancelled = true; };
  }, [tab, gateway.signedIn, gateway.address, gateway.refreshedAt]);
  return <><PageHeader title="Services" description="Verified endpoints, immutable price versions, and evidence for every result." actions={<Button variant="quiet" aria-label="Refresh service catalog"
    disabled={Boolean(gateway.busy)} onClick={() => { void gateway.refresh(); }}><RefreshCw size={16} /></Button>} />
    <div className="tabs" aria-label="Service views"><button type="button" aria-pressed={tab === "browse"} onClick={() => setTab("browse")}>Service catalog</button>
      <button type="button" aria-pressed={tab === "manage"} onClick={() => setTab("manage")}>Provider & credentials</button></div>
    {tab === "browse" ? <>
      {gateway.services.length ? <div className="service-list">{gateway.services.map(service => <article className="service-row" key={service.id}>
        <div className="service-icon">{service.method === "json_validate" ? <Braces size={22} aria-hidden="true" /> : <Brain size={22} aria-hidden="true" />}</div>
        <div><h2>{service.name}<Badge tone="mint">Verified terms</Badge></h2><p>{service.manifest.description}</p><div className="service-meta"><code>{service.method}</code>
          <span>Price v{service.priceVersion}</span><span>Signer <code title={service.signer}>{short(service.signer)}</code></span></div>
          <details className="network-details"><summary>Service identity</summary><p>Service ID: <code>{service.id}</code></p><p>Provider: <code>{String(service.provider)}</code></p>
            <p>Endpoint: <code>{service.endpoint}</code></p><p>Signatures bind the response to this request and price version.</p></details></div>
        <div className="service-price"><p className="mono">{demo(service.priceBaseUnits)} DEMO<small>per request</small></p><Link className="button button-secondary" href={`/playground?service=${service.id}`}>Try service<ArrowRight size={15} aria-hidden="true" /></Link></div>
      </article>)}</div> : <EmptyState title={gateway.loading ? "Loading verified services" : "No verified services available"} action={<Button variant="secondary" onClick={() => { void gateway.refresh(); }}>Refresh catalog</Button>}>
        The catalog includes only active services whose signed endpoint and onchain price terms match. Check the gateway or register a provider endpoint.</EmptyState>}
      <p className="form-note section">JSON validation reports document and schema checks. AI analysis reports its model, runtime, and usage evidence. A signed response does not prove the correctness of AI output.</p>
    </> : <WalletGate>
      {usage && <dl className="summary-strip"><div className="summary-item"><dt>Provider requests</dt><dd className="mono">{usage.totalRequests}</dd><p>Across your registered services</p></div>
        <div className="summary-item"><dt>Confirmed payments</dt><dd className="mono">{usage.settledRequests}</dd><p>Indexed settlements</p></div>
        <div className="summary-item"><dt>Confirmed amount</dt><dd className="mono">{demo(usage.settledBaseUnits)}<small>DEMO</small></dd><p>DEMO test tokens</p></div>
        <div className="summary-item"><dt>Your services</dt><dd className="mono">{gateway.account?.stats.providerServices ?? 0}</dd><p>Registered provider endpoints</p></div></dl>}
      <section className="section"><div className="section-heading"><div><h2>Register a service</h2><p>The gateway verifies a signed endpoint probe and exact registered terms.</p></div></div>
        <form className="form-stack" onSubmit={event => {
          event.preventDefault(); setLocalError(undefined);
          try { const value = ServiceManifestSchema.parse(parseStrictJson(manifest)); void gateway.registerService(value).catch(() => undefined); }
          catch { setLocalError("Paste a valid emeter-service-v1 manifest with its service ID, method, endpoint, price in base units, container, signer, and payout address."); }
        }}><Field label="Service manifest JSON" hint="Use a provider endpoint that returns signed emeter_probe responses. Its wallet must be allowlisted on the registry.">
          <textarea className="mono" name="manifest" value={manifest} disabled={Boolean(gateway.busy || gateway.pending)} onChange={event => setManifest(event.target.value)} placeholder={'{\n  "version": "emeter-service-v1",\n  "serviceId": "0x…",\n  "name": "Your service",\n  "description": "What it does",\n  "method": "json_validate",\n  "endpoint": "https://…",\n  "priceBaseUnits": "50000",\n  "container": "0x…",\n  "signer": "0x…",\n  "payout": "0x…"\n}'} required spellCheck={false} rows={13} /></Field>
          <div className="actions"><Button type="submit" disabled={Boolean(gateway.busy || gateway.pending) || !manifest.trim()}>Verify endpoint and register</Button></div></form>
      </section>
      {localError && <p className="inline-error" role="alert">{localError}</p>}
      <Credentials />
      {usage && <section className="section"><div className="section-heading"><div><h2>Provider activity</h2><p>Recent requests to your services; payment and execution are separate.</p></div></div>
        {usage.recent.length ? <div className="table-scroll" tabIndex={0} aria-label="Provider activity"><table className="data-table"><thead><tr><th scope="col">Request</th><th scope="col">Execution</th><th scope="col">Payment</th><th scope="col" className="align-right">DEMO</th><th scope="col">Created</th></tr></thead>
          <tbody>{usage.recent.map(request => <tr key={request.requestId}><td><code>{short(request.requestId, 12, 6)}</code></td><td><RequestBadge status={request.requestStatus} /></td><td><PaymentBadge status={request.paymentStatus} /></td>
            <td className="align-right mono">{demo(request.priceBaseUnits)}</td><td className="nowrap muted">{time(request.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No provider requests yet">Activity appears after a customer runs one of your registered services.</EmptyState>}
      </section>}
    </WalletGate>}
  </>;
}
