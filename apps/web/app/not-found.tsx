import Link from "next/link";

export default function NotFound() {
  return <main className="landing"><div className="empty-state section"><h1>This page could not be found.</h1><p>Check the route or request ID, then return to the workspace.</p><div className="actions"><Link href="/dashboard" className="button button-primary">Open workspace</Link></div></div></main>;
}
