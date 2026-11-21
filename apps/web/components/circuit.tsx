"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { flagsFromMask, policyDecision } from "@emeter/circuit";
import { CircleCheck, CircleX } from "lucide-react";
import { circuitSignals, circuitWires, signalPositions } from "./circuit-graph";

const Scene = dynamic(() => import("./circuit-scene"), { ssr: false });
class GraphicsBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}
function FlatCircuit({ mask }: { mask: number }) {
  const values = circuitSignals(mask);
  const at = (id: number) => { const [x, y] = signalPositions[id]!; return [x * 61 + 366, -y * 61 + 176] as const; };
  return <svg className="circuit-flat" viewBox="0 0 730 360" aria-hidden="true" focusable="false">
    <defs><pattern id="circuit-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#2c393d" /></pattern></defs>
    <rect x="10" y="0" width="710" height="350" fill="url(#circuit-grid)" />
    {circuitWires.map(({ source, target }) => {
      const [x1, y1] = at(source), [x2, y2] = at(target), middle = (x1 + x2) / 2;
      return <path key={`${source}-${target}`} d={`M ${x1 + 22} ${y1} H ${middle} V ${y2} H ${x2 - 22}`} fill="none"
        stroke={values[source] ? "#63efb7" : "#4c6268"} strokeWidth={values[source] ? 2 : 1.2} strokeLinejoin="round" />;
    })}
    {Object.keys(signalPositions).map(key => {
      const id = Number(key), [x, y] = at(id), active = values[id]!, width = id === 18 ? 72 : 44;
      return <g key={id}><rect x={x - width / 2} y={y - 16} width={width} height="32" rx="4" fill={active ? "#63efb7" : "#192225"} stroke={active ? "#63efb7" : "#4c6268"} />
        <text x={x} y={y + 4} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="11" fontWeight="500" fill={active ? "#080c0d" : "#afbfbe"}>
          {id < 8 ? String.fromCharCode(65 + id - 2) : id === 18 ? active ? "ALLOW" : "DENY" : "N" + (id - 7)}</text></g>;
    })}
    <text x="40" y="341" fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#8faaa8">A · B · C · D · (E + F)</text>
    <text x="690" y="341" textAnchor="end" fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#8faaa8">11 NAND GATES</text>
  </svg>;
}
export function Circuit({ mask, source = "Preview · no transaction" }: { mask: number; source?: string }) {
  const [graphics, setGraphics] = useState(false);
  const [graphicsReady, setGraphicsReady] = useState(false);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 801px)"), motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (!desktop.matches || motionPreference.matches) { setGraphics(false); setGraphicsReady(false); return; }
      try {
        const canvas = document.createElement("canvas"), context = canvas.getContext("webgl2");
        setGraphics(Boolean(context)); context?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch { setGraphics(false); }
    };
    update(); desktop.addEventListener("change", update); motionPreference.addEventListener("change", update);
    return () => { desktop.removeEventListener("change", update); motionPreference.removeEventListener("change", update); };
  }, []);
  const allowed = policyDecision(flagsFromMask(mask));
  return <figure className="circuit" aria-label={`Payment policy circuit. Input mask ${mask.toString(2).padStart(6, "0")}. ${allowed ? "Allows" : "Denies"} payment. ${source}.`}>
    <div className="circuit-stage"><FlatCircuit mask={mask} />{graphics && <div className="circuit-webgl" style={{ opacity: graphicsReady ? 1 : 0 }}>
      <GraphicsBoundary onFailure={() => { setGraphics(false); setGraphicsReady(false); }}><Scene mask={mask} onReady={() => setGraphicsReady(true)} onFailure={() => { setGraphics(false); setGraphicsReady(false); }} /></GraphicsBoundary></div>}</div>
    <figcaption className="circuit-caption"><span>{source}</span><span>Mask <code>0x{mask.toString(16).padStart(2, "0")}</code> · <code>{mask.toString(2).padStart(6, "0")}</code></span><span>TapeOut · 6 inputs / 1 output</span></figcaption>
  </figure>;
}
export function PolicyOutput({ mask }: { mask: number }) {
  const allowed = policyDecision(flagsFromMask(mask));
  const Icon = allowed ? CircleCheck : CircleX;
  return <motion.div className="policy-output" animate={{ color: allowed ? "#63efb7" : "#ffaaa0" }} transition={{ duration: .22, ease: [.22, 1, .36, 1] }}>
    <Icon size={30} aria-hidden="true" /><div><strong>{allowed ? "Payment allowed" : "Payment denied"}</strong><p>{allowed ? "All required conditions are satisfied." : "A required condition is missing."}</p></div>
  </motion.div>;
}
