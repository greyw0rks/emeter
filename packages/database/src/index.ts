import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export { PrismaClient, Prisma } from "./generated/client.js";
export { Pool as PostgresPool } from "pg";
export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000 }) });
}
export type Database = ReturnType<typeof createDatabase>;
