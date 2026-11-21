"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { keccak256, toHex } from "viem";
import { HashSchema } from "@emeter/shared";
import { useGateway } from "../../../components/gateway-provider";
import { ActivityTable, Button, Field, PageHeader, WalletGate } from "../../../components/ui";

export default function Receipts() {
  const gateway = useGateway(), router = useRouter(), [requestId, setRequestId] = useState("");
  return <><PageHeader title="Receipts" description="Find a signed result and check the evidence behind its payment." />
    <WalletGate><form className="receipt-lookup" onSubmit={event => {
      event.preventDefault(); const value = requestId.trim();
      const id = HashSchema.safeParse(value); router.push("/receipts/" + (id.success ? id.data : keccak256(toHex(value))));
    }}><Field label="Request ID or client request ID" hint="Use the request hash or original client ID from the playground or SDK."><input value={requestId} onChange={event => setRequestId(event.target.value)} placeholder="0x… or a client request ID" required maxLength={128} autoComplete="off" /></Field>
      <div className="actions"><Button type="submit" disabled={!requestId.trim()}>Inspect receipt</Button></div></form>
      <section className="section"><div className="section-heading"><h2>Recent requests</h2></div><ActivityTable requests={gateway.account?.requests ?? []} /></section></WalletGate>
  </>;
}
