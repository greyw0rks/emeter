"use node";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

export function createConvexQueue(ctx: ActionCtx, prefix: string, queue: "execution" | "settlement") {
  const key = (id: string) => prefix + ":" + queue + ":" + id;
  return {
    add: async (_name: string, data: { requestId: string }, options: { jobId: string }) =>
      ctx.runMutation(internal.queue.enqueue, { key: key(options.jobId), queue, requestId: data.requestId, maximumAttempts: queue === "execution" ? 4 : 8 }),
    getJobCounts: () => ctx.runQuery(internal.queue.counts, { queue }),
    getJob: async (id: string) => {
      const row = await ctx.runQuery(internal.queue.get, { key: key(id) });
      return row ? { getState: async () => row.status,
        retry: () => ctx.runMutation(internal.queue.retry, { key: row.key }),
        remove: () => ctx.runMutation(internal.queue.remove, { key: row.key }) } : null;
    },
    close: async () => undefined
  };
}
