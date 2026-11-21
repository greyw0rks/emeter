import { DEPLOYMENT, publicUrl } from "../../../lib/wallet";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    return Response.json({ gatewayUrl: publicUrl(process.env.EMETER_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:4100"),
      ...(process.env.EMETER_PUBLIC_RPC_URL ? { rpcUrl: publicUrl(process.env.EMETER_PUBLIC_RPC_URL) } : {}), deployment: DEPLOYMENT },
      { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "INVALID_PUBLIC_CONFIGURATION" }, { status: 500 }); }
}
