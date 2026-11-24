"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Circuit, PolicyOutput } from "../components/circuit";
import { Wordmark } from "../components/workspace";
import { ActionLink, Button, GlobalFeedback, NetworkBadge, WalletButton } from "../components/ui";
import { DEPLOYMENT } from "../lib/wallet";

export default function Home() {
  const [mask, setMask] = useState(31);
  return <div className="landing"><a href="#main" className="skip-link">Skip to content</a>
    <header className="landing-header"><Wordmark /><nav className="landing-nav" aria-label="Main"><Link href="/services">Services</Link>
      <Link href="/policy" className="landing-hide-mobile">The policy</Link><WalletButton /></nav></header>
    <main id="main"><GlobalFeedback /><section className="landing-hero"><div><h1>Give your agents a <span>spending limit.</span></h1>
      <p className="hero-description">Programmable payments for AI agents and APIs. Authorize a budget, run a request, and let the circuit govern its payment.</p>
      <div className="actions"><ActionLink href="/dashboard">Open workspace</ActionLink><Link href="/policy" className="text-link">Explore the policy<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
      <p className="hero-note">X Layer · Signed receipts · USDC payments</p></div>
      <div className="hero-circuit"><div className="hero-circuit-head"><strong>The payment policy, in motion</strong><span>Interactive preview</span></div>
        <Circuit mask={mask} /><PolicyOutput mask={mask} />
        <div className="circuit-controls" aria-label="Circuit preview scenarios"><Button variant="secondary" aria-pressed={mask === 31} onClick={() => setMask(31)}>Within limits</Button>
          <Button variant="secondary" aria-pressed={mask === 15} onClick={() => setMask(15)}>Soft limit reached</Button>
          <Button variant="secondary" aria-pressed={mask === 47} onClick={() => setMask(47)}>Customer override</Button></div>
      </div></section>
      <div className="landing-flow"><div><h2>Authorize the boundaries.</h2><p>Choose the services, hard budget, per-request maximum, soft limit, and expiry.</p></div>
        <div><h2>Run a useful request.</h2><p>Validate JSON or analyze text. Keep the response and its signed usage evidence.</p></div>
        <div><h2>Inspect what actually paid.</h2><p>Check the receipt, original price version, and matching confirmed settlement.</p></div></div>
      <section className="landing-proof"><div><h2>A payment needs more than a response.</h2><p>The onchain circuit checks six conditions. Crossing a soft limit needs a separate customer signature; a hard budget stays fixed.</p>
        <p>A provider signature attributes its output and reported usage. Payment confirmation comes from a matching transaction on the configured chain.</p>
        <Link className="text-link" href="/policy">See every condition<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        <div className="proof-rows"><div><strong>Deployed on X Layer</strong><p>The circuit and payment engine have recorded mainnet proof.</p>
          <a href={`https://www.oklink.com/xlayer/tx/${DEPLOYMENT.proofTransaction}`} target="_blank" rel="noreferrer" className="text-link">Inspect the proof transaction<ArrowUpRight size={14} aria-hidden="true" /></a></div>
          <div><strong>Pay providers in USDC</strong><p>Fund credit with USDC on X Layer. Set a budget for AI analysis or JSON validation and inspect the signed result and confirmed payment.</p></div>
          <div><strong>Your wallet sets the rules</strong><p>Delegated keys stay in this tab. Close sessions, revoke signers, and recover unused credit with the owning wallet.</p></div></div>
      </section></main>
    <footer className="landing-footer"><span>emeter. Meter every request. Control every payment.</span><div><NetworkBadge /><Link href="/dashboard">Workspace</Link></div></footer>
  </div>;
}
