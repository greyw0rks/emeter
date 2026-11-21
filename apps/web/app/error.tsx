"use client";

import { useEffect } from "react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { document.title = "Page unavailable · emeter"; }, []);
  return <main className="landing"><div className="empty-state section"><h1>The page could not load.</h1><p>Retry this page. Your confirmed transactions and gateway records remain available.</p><div className="actions"><button type="button" className="button button-primary" onClick={reset}>Retry page</button></div></div></main>;
}
