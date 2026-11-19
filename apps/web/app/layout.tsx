import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "emeter — Programmable payments for AI agents and APIs",
  description: "Programmable API payments on X Layer. The circuit-governed settlement foundation is verified."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
