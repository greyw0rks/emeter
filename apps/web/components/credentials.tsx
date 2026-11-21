"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useGateway } from "./gateway-provider";
import { Badge, Button, CopyValue, Dialog, EmptyState, Field } from "./ui";
import type { ApiCredential } from "../lib/models";
import { short, time } from "../lib/models";
import { errorMessage } from "../lib/errors";

export function Credentials() {
  const gateway = useGateway();
  const [keys, setKeys] = useState<ApiCredential[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState<string>();
  const [open, setOpen] = useState(false), [resource, setResource] = useState(""), [execute, setExecute] = useState(true);
  const [once, setOnce] = useState<{ id: string; key: string }>();
  const owned = gateway.services.filter(service => String(service.provider).toLowerCase() === gateway.address?.toLowerCase());
  const sessions = gateway.account?.sessions.filter(session => session.status !== 3 && gateway.network?.anchor
    && BigInt(session.refundAfter) > BigInt(gateway.network.anchor.timestamp)) ?? [];
  const reload = async () => { try { setKeys(await gateway.getKeys()); setLoaded(true); setError(undefined); } catch (failure) { setError(errorMessage(failure)); } };
  useEffect(() => { void reload(); return () => setOnce(undefined); }, [gateway.address, gateway.signedIn]);
  return <section className="section"><div className="section-heading"><div><h2>Scoped credentials</h2><p>Service keys can read provider usage. Session keys can read requests and optionally execute.</p></div>
    <Button variant="secondary" disabled={Boolean(gateway.busy) || (!owned.length && !sessions.length)} onClick={() => {
      gateway.clearError(); setResource(sessions[0] ? "session:" + sessions[0].sessionId : owned[0] ? "service:" + owned[0].id : ""); setOpen(true);
    }}>Create credential</Button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {once && <div className="key-once"><h3>Copy this credential now</h3><p>It is shown once and kept only in memory. An execution credential also needs the delegated session signer; it does not contain that signing key.</p>
      <CopyValue value={once.key} label="Copy API credential" /><div className="actions"><Button variant="secondary" onClick={() => setOnce(undefined)}>I’ve saved it; hide credential</Button></div></div>}
    {loaded && !keys.length ? <EmptyState title="No credentials created">Create a session or register a service, then issue a key for that specific resource.</EmptyState>
      : keys.length ? <div className="table-scroll" tabIndex={0} aria-label="Scoped credentials"><table className="data-table"><thead><tr><th scope="col">Resource</th><th scope="col">Scope</th><th scope="col">Expires</th><th scope="col">State</th><th scope="col">Action</th></tr></thead>
        <tbody>{keys.map(key => { const expired = Boolean(key.expiresAt && Date.parse(key.expiresAt) <= Date.now()); return <tr key={key.id}><td>{key.sessionId ? "Session" : "Service"} <code>{short(key.sessionId ?? key.serviceId ?? key.id, 10, 6)}</code></td>
          <td><code>{key.scopes.join(", ")}</code></td><td className="nowrap muted">{key.expiresAt ? time(key.expiresAt) : "No expiry"}</td><td><Badge tone={key.revokedAt || expired ? "neutral" : "mint"}>{key.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}</Badge></td>
          <td><Button variant="quiet" disabled={Boolean(key.revokedAt || gateway.busy)} onClick={() => {
            void gateway.revokeKey(key.id).then(() => { if (once?.id === key.id) setOnce(undefined); return reload(); }).catch(() => undefined);
          }}>Revoke</Button></td></tr>; })}</tbody></table></div> : <p className="loading-copy">Loading credentials…</p>}
    <Dialog open={open} onClose={() => setOpen(false)} title="Create a scoped credential"><form className="form-stack" onSubmit={event => {
      event.preventDefault(); const [kind, id] = resource.split(":");
      void gateway.createKey(kind === "session" ? { sessionId: id as Hex, scopes: execute ? ["execute", "request:read"] : ["request:read"] }
        : { serviceId: id as Hex, scopes: ["usage:read"] }).then(value => { setOnce(value); setOpen(false); return reload(); }).catch(() => undefined);
    }}><Field label="Resource"><select value={resource} disabled={Boolean(gateway.busy)} onChange={event => setResource(event.target.value)} required><optgroup label="Your sessions">{sessions.map(session => <option key={session.sessionId} value={`session:${session.sessionId}`}>{short(session.sessionId, 10, 6)}</option>)}</optgroup>
      <optgroup label="Your services">{owned.map(service => <option key={service.id} value={`service:${service.id}`}>{service.name}</option>)}</optgroup></select></Field>
      {resource.startsWith("session:") ? <><p className="form-note">Can read requests for this session. It expires with the session’s refund window.</p><label className="checkbox-row"><input type="checkbox" checked={execute} disabled={Boolean(gateway.busy)} onChange={event => setExecute(event.target.checked)} />Allow execution with this session’s delegated signer</label></>
        : <p className="form-note">Can read usage for this service. It cannot change service terms or grant spending permission.</p>}
      <div className="actions"><Button variant="secondary" disabled={Boolean(gateway.busy)} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(gateway.busy) || !resource}>Create credential</Button></div></form></Dialog>
  </section>;
}
