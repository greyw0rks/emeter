import { publicUrl } from "../../../lib/wallet";
import { configuredPaymentDeployment } from "@emeter/shared";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    return Response.json({ gatewayUrl: publicUrl(process.env.EMETER_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:4100"),
      ...(process.env.EMETER_PUBLIC_RPC_URL ? { rpcUrl: publicUrl(process.env.EMETER_PUBLIC_RPC_URL) } : {}),
      deployment: configuredPaymentDeployment(process.env) },
      { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const pending = error instanceof Error && error.message === "USDC_DEPLOYMENT_PENDING";
    return Response.json({ error: pending ? "USDC_DEPLOYMENT_PENDING" : "INVALID_PUBLIC_CONFIGURATION" }, { status: pending ? 503 : 500 });
  }
}
