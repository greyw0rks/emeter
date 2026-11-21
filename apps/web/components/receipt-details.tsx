"use client";

import { ArrowUpRight, CheckCircle2, Download } from "lucide-react";
import type { EmeterResult } from "@emeter/sdk";
import { Button, CopyValue, Badge, PaymentBadge, RequestBadge } from "./ui";
import { useGateway } from "./gateway-provider";
import { demo } from "../lib/models";
import { z } from "zod";

const reportedUsageSchema = z.object({ receipt: z.object({ result: z.object({ usage: z.object({
  prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative()
}), prices: z.array(z.object({ amount: z.string(), currency: z.string() })).optional() }).passthrough() }).passthrough() }).passthrough();

export function ReceiptDetails({ record, compact = false }: { record: EmeterResult; compact?: boolean }) {
  const { network } = useGateway();
  const body = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
  const model = body?.model && typeof body.model === "object" ? body.model as Record<string, unknown> : undefined;
  const usage = record.receipt?.reportedUsage as Record<string, unknown> | null | undefined;
  const reported = reportedUsageSchema.safeParse(usage);
  const output = JSON.stringify(record.serviceManifest.method === "text_analyze" && body?.analysis !== undefined ? body.analysis : record.data, null, 2) ?? "null";
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "emeter-" + record.requestId.slice(2, 14) + ".json";
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <><div className="receipt-heading"><RequestBadge status={record.requestStatus} /><PaymentBadge status={record.paymentStatus} />
    <Badge tone={record.receiptVerified ? "mint" : "neutral"}>{record.receiptVerified ? "Signature verified" : record.receipt ? "Signature not yet checked" : "No signed receipt yet"}</Badge>
    {record.settlementVerified && <Badge tone="mint"><CheckCircle2 size={11} aria-hidden="true" />&nbsp;Canonical payment verified</Badge>}
    {network?.networkMode === "local-fork" && <Badge tone="lime">Local fork</Badge>}</div>
    {record.error && <p className="inline-error">Gateway result: <code>{record.error}</code></p>}
    {record.receipt && <><div className="section-heading"><h2>Signed output</h2><Button variant="quiet" onClick={download}><Download size={14} aria-hidden="true" />Download receipt</Button></div>
      {model && <p className="form-note">Model <code>{String(model.id ?? "unreported")}</code> · {model.runtime === "offline-fixture" ? "Controlled offline fixture" : String(model.runtime ?? "runtime unreported")}</p>}
      <div className="result-output"><pre>{output.length > 24_000 ? output.slice(0, 24_000) + "\n… Full output is in the receipt download." : output}</pre></div>
      {usage && <div className="section"><h3>Provider-reported usage</h3>{reported.success ? <dl className="evidence-list">
        <div><dt>Input tokens</dt><dd className="mono">{reported.data.receipt.result.usage.prompt_tokens}</dd></div>
        <div><dt>Output tokens</dt><dd className="mono">{reported.data.receipt.result.usage.completion_tokens}</dd></div>
        <div><dt>Total tokens</dt><dd className="mono">{reported.data.receipt.result.usage.total_tokens}</dd></div>
        {reported.data.receipt.result.prices && <div><dt>Reported upstream cost</dt><dd className="mono">{reported.data.receipt.result.prices.map(price => price.amount + " " + price.currency).join(", ")}</dd></div>}
      </dl> : <pre>{JSON.stringify(usage, null, 2)}</pre>}<p className="form-note section">Usage is attributed to the provider by its signature. AI output correctness and customer acceptance are separate.</p></div>}
    </>}
    {!compact && <section className="section"><h2>Request and payment evidence</h2><dl className="evidence-list">
      <div><dt>Request ID</dt><dd><CopyValue value={record.requestId} label="Copy request ID" /></dd></div>
      <div><dt>Client request ID</dt><dd><CopyValue value={record.clientId} label="Copy client request ID" /></dd></div>
      <div><dt>Session</dt><dd><CopyValue value={record.sessionId} label="Copy receipt session ID" /></dd></div>
      <div><dt>Service / version</dt><dd>{record.serviceManifest.name} · price v{record.priceVersion} · {demo(record.priceBaseUnits)} DEMO</dd></div>
      <div><dt>Request hash</dt><dd><CopyValue value={record.requestHash} label="Copy request hash" /></dd></div>
      {record.receipt && <><div><dt>Body hash</dt><dd><CopyValue value={record.receipt.bodyHash} label="Copy body hash" /></dd></div>
        <div><dt>Receipt digest</dt><dd><CopyValue value={record.receipt.digest} label="Copy receipt digest" /></dd></div>
        <div><dt>Provider signer</dt><dd><CopyValue value={record.receipt.signer} label="Copy provider signer" /></dd></div>
        <div><dt>Provider signature</dt><dd><CopyValue value={record.receipt.envelope.sig} label="Copy provider signature" /></dd></div></>}
      <div><dt>Charge maximum</dt><dd className="mono">{demo(record.authorization.maxAmount)} DEMO</dd></div>
      <div><dt>Charge signature</dt><dd><CopyValue value={record.chargeSignature} label="Copy charge signature" /></dd></div>
      <div><dt>Request expires</dt><dd>{new Date(Number(record.authorization.validUntil) * 1000).toLocaleString()}</dd></div>
      <div><dt>Customer acceptance</dt><dd>{record.customerAcceptance === "not_requested" ? "Not requested" : record.customerAcceptance.replaceAll("_", " ")}</dd></div>
      <div><dt>Transaction</dt><dd>{record.transaction ? <><CopyValue value={record.transaction.hash} label="Copy settlement transaction hash" />
        {network?.networkMode === "mainnet" && <a className="text-link" href={`https://www.oklink.com/xlayer/tx/${record.transaction.hash}`} target="_blank" rel="noreferrer">Explorer<ArrowUpRight size={13} aria-hidden="true" /></a>}
        <p className="form-note">{record.settlementVerified ? "Canonical receipt, settlement call, and matching event independently checked." : "Payment has not been independently confirmed."}{network?.networkMode === "local-fork" ? " This hash belongs to the local fork." : ""}</p></> : "No transaction submitted"}</dd></div>
      {record.transaction?.blockNumber && <div><dt>Settlement block</dt><dd className="mono">{record.transaction.blockNumber}</dd></div>}
    </dl></section>}
    {record.receipt && <section className="section"><details><summary>Full signed envelope and request authorization</summary><div className="result-output"><pre>{JSON.stringify({ call: record.call, authorization: record.authorization,
      envelope: record.receipt.envelope }, null, 2)}</pre></div></details></section>}
  </>;
}
