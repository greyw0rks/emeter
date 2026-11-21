import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GatewayProvider } from "../components/gateway-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "emeter — Programmable payments for AI agents and APIs",
  description: "Meter every request. Control every payment. Bounded sessions and signed API receipts, governed by a payment policy on X Layer."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body><GatewayProvider>{children}</GatewayProvider></body></html>;
}
