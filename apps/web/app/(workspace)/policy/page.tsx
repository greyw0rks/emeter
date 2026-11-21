"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { POLICY_INPUTS, POLICY_V1_NETLIST_HASH } from "@emeter/circuit";
import { useGateway } from "../../../components/gateway-provider";
import { Circuit, PolicyOutput } from "../../../components/circuit";
import { Button, CopyValue, EmptyState, Field, PageHeader, WalletButton } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { DEPLOYMENT } from "../../../lib/wallet";
import { short } from "../../../lib/models";

const labels = [
  ["Service authorized", "The registered service and price version are allowed."], ["Receipt verified", "A valid provider signature binds this response."],
  ["Charge authorized", "The session signer approved the request and amount."], ["Session active", "The request satisfies the session’s execution rules."],
  ["Within soft limit", "Cumulative spending stays within the signed soft limit."], ["Customer override", "A separate customer signature approves crossing it."]
] as const;
export default function Policy() {
  const gateway = useGateway(), [mode, setMode] = useState<"preview" | "receipt">("preview"), [preview, setPreview] = useState(31);
  const [selected, setSelected] = useState(""), [recorded, setRecorded] = useState<{ mask: number; confirmed: boolean }>(), [error, setError] = useState<string>(), [checking, setChecking] = useState(false);
  const mask = mode === "preview" ? preview : recorded?.mask;
  useEffect(() => { setRecorded(undefined); setSelected(""); setError(undefined); }, [gateway.address]);
  return <><PageHeader title="Policy explorer" description="See how six conditions decide whether a payment is allowed." />
    <div className="tabs" aria-label="Policy data source"><button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Interactive preview</button>
      <button type="button" aria-pressed={mode === "receipt"} onClick={() => setMode("receipt")}>From a receipt</button></div>
    {mode === "receipt" && <div className="form-stack section-heading">{gateway.signedIn ? <><Field label="Your request"><select value={selected} onChange={event => { setSelected(event.target.value); setRecorded(undefined); }}><option value="">Select a request with policy evidence</option>
      {gateway.account?.requests.filter(value => value.policyInputs !== null).map(value => <option key={value.requestId} value={value.requestId}>{value.serviceName} · {short(value.requestId, 10, 6)}</option>)}</select></Field>
      <div className="actions"><Button variant="secondary" disabled={!selected || checking} onClick={() => {
        setChecking(true); setError(undefined);
        void gateway.verifyRequest(selected as `0x${string}`).then(value => {
          const inputMask = value.transaction?.policyInputs ?? value.policyInputs;
          if (inputMask === null || inputMask === undefined) throw new Error("No policy evaluation is recorded for this request.");
          setRecorded({ mask: inputMask, confirmed: value.settlementVerified });
        }).catch(failure => setError(errorMessage(failure))).finally(() => setChecking(false));
      }}>{checking ? "Verifying evidence…" : "Verify and load inputs"}</Button>{selected && <Link href={`/receipts/${selected}`} className="text-link">Inspect full receipt</Link>}</div></>
      : <EmptyState title="Connect to load your receipt" action={<WalletButton />}>Your wallet login allows this page to read your own request evidence.</EmptyState>}
      {error && <p className="inline-error" role="alert">{error}</p>}</div>}
    <div className="policy-layout"><div className="policy-inputs">{POLICY_INPUTS.map((key, bit) => <label key={key} className="policy-input"><input type="checkbox" checked={Boolean((mask ?? 0) & (1 << bit))}
      disabled={mode === "receipt"} onChange={event => setPreview(previous => event.target.checked ? previous | (1 << bit) : previous & ~(1 << bit))} />
      <span><strong><code>{String.fromCharCode(65 + bit)}</code>{labels[bit]![0]}</strong><small>{labels[bit]![1]}</small></span></label>)}</div>
      <div>{mask !== undefined ? <><Circuit mask={mask} source={mode === "preview" ? "Interactive preview · no authorization or transaction" : recorded?.confirmed ? "Canonical settlement inputs" : "Gateway-recorded inputs · payment unconfirmed"} />
        <PolicyOutput mask={mask} /></> : <EmptyState title="Load a recorded policy evaluation">Choose a request and verify its evidence to drive the circuit with its actual input mask.</EmptyState>}
        <p className="policy-formula mono">A ∧ B ∧ C ∧ D ∧ (E ∨ F)</p><p className="form-note section">{mode === "preview" ? "Toggling an input only changes this preview. It grants no spending permission and signs no customer override." : "A gateway-recorded mask is labeled unconfirmed until a matching canonical settlement is independently verified."}</p></div>
    </div>
    <section className="section"><div className="section-heading"><h2>The deployed circuit</h2><a className="text-link" href={`https://www.oklink.com/xlayer/tx/${DEPLOYMENT.proofTransaction}`} target="_blank" rel="noreferrer">Mainnet proof<ArrowUpRight size={15} aria-hidden="true" /></a></div>
      <dl className="evidence-list"><div><dt>Implementation</dt><dd>11 stateless NAND gates · TapeOut TAP-02 · X Layer chain 196</dd></div>
        <div><dt>Netlist hash</dt><dd><CopyValue value={POLICY_V1_NETLIST_HASH} label="Copy circuit netlist hash" /></dd></div>
        <div><dt>Policy adapter</dt><dd><CopyValue value={DEPLOYMENT.adapter} label="Copy policy adapter address" /></dd></div></dl>
      <p className="form-note section">Hard budget, per-request maximum, scope, expiry, and signature checks are enforced by the vault around this circuit. A soft-limit override cannot increase the hard budget.</p>
    </section>
  </>;
}
