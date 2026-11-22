"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ArrowUpRight, Boxes, CircuitBoard, FlaskConical, LayoutDashboard, ReceiptText } from "lucide-react";
import { useGateway } from "./gateway-provider";
import { GlobalFeedback, NetworkBadge, WalletButton } from "./ui";

export function Wordmark() {
  return <Link href="/" className="wordmark" aria-label="emeter home"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="M4 8h10v5H8v7h16M4 14h4M14 8h10M19 8v12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    <circle cx="4" cy="8" r="2" fill="currentColor" /><circle cx="24" cy="20" r="2" fill="currentColor" /></svg>emeter<span className="wordmark-stop">.</span></Link>;
}
const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard }, { href: "/services", label: "Services", icon: Boxes },
  { href: "/playground", label: "Playground", icon: FlaskConical }, { href: "/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/policy", label: "Policy explorer", icon: CircuitBoard }
];
export function Workspace({ children }: { children: ReactNode }) {
  const path = usePathname(), { config, network } = useGateway();
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const revealCurrent = () => {
      const link = nav.querySelector<HTMLAnchorElement>('[aria-current="page"]');
      if (!link || !nav.clientWidth) return;
      const band = nav.getBoundingClientRect(), current = link.getBoundingClientRect();
      if (current.left < band.left || current.right > band.right)
        nav.scrollTo({ left: nav.scrollLeft + current.left - band.left - (nav.clientWidth - current.width) / 2, behavior: "auto" });
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [path]);
  return <div className="workspace"><a href="#workspace-content" className="skip-link">Skip to content</a>
    <header className="workspace-header"><div className="workspace-topbar"><Wordmark /><div className="workspace-account"><NetworkBadge /><WalletButton /></div></div>
    <nav ref={navigation} className="workspace-nav" aria-label="Workspace">{links.map(({ href, label, icon: Icon }) => {
      const active = path === href || path.startsWith(href + "/");
      return <Link key={href} href={href} className={`nav-link ${active ? "nav-active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden="true" />{label}</Link>;
    })}</nav></header>
      <main id="workspace-content" className="workspace-main"><GlobalFeedback />{children}</main>
      <footer className="workspace-footer"><span>emeter · Bounded API payments</span><span>DEMO is a test token · X Layer · Chain 196</span>
        <Link className="text-link" href="/policy">How settlement works<ArrowUpRight size={14} aria-hidden="true" /></Link>
        <span>{network?.networkMode === "local-fork" ? "Local fork · payments stay on this fork" : "Gateway: " + (config ? new URL(config.gatewayUrl).host : "unavailable")}</span></footer>
  </div>;
}
