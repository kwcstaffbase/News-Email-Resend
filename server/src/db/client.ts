import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createLogger } from "../lib/logger.ts";
import { changelog, items, sessions, settings, users } from "./schema.ts";

const url = Bun.env.DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const IS_LOCALDEV = (Bun.env.IS_LOCALDEV ?? process.env.IS_LOCALDEV) === "true";
const LOG_SQL = IS_LOCALDEV && (Bun.env.LOG_SQL ?? process.env.LOG_SQL) === "true";

const sqlLogger = createLogger("sql");
const drizzleLogger = LOG_SQL
  ? {
      logQuery(query: string, params: unknown[]): void {
        // Use info level — user explicitly opted in with LOG_SQL=true
        sqlLogger.info("SQL query.", { query, params });
      },
    }
  : false;

const ssl =
  (process.env.NODE_ENV ?? Bun.env.NODE_ENV) === "production"
    ? { rejectUnauthorized: false }
    : false;

const sql = postgres(url, { max: 10, ssl });

export const db = drizzle(sql, {
  schema: {
    users,
    sessions,
    settings,
    items,
    changelog,
  },
  // Set LOG_SQL=true in .env to print every SQL query in local dev (structured output)
  logger: drizzleLogger,
});

export { changelog, items, sessions, settings, users } from "./schema.ts";
export { LOG_SQL };
