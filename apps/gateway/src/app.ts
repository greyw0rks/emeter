import Fastify from "fastify";
import type { ProtocolStatus } from "@emeter/shared";

export function buildGateway(options: { recordedMainnetProofVerified?: boolean } = {}) {
  const app = Fastify({ logger: false });
  const status: ProtocolStatus = {
    name: "emeter", phase: "protocol-validation", chainId: 196,
    paidExecutionReady: false, mainnetProofVerified: options.recordedMainnetProofVerified ?? false
  };
  app.get("/health", async () => ({ ok: true, ...status }));
  app.get("/api/protocol", async () => status);
  app.post("/api/execute/:serviceId", async (_request, reply) => {
    return reply.code(503).send({ error: "PAID_EXECUTION_NOT_READY", message: "Paid API execution follows verified circuit-gated settlement." });
  });
  return app;
}
