import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("canonical chain and durable-job recovery", { seconds: 60 }, internal.runtime.maintenance, {});
export default crons;
