import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? Bun.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const ssl =
  (process.env.NODE_ENV ?? Bun.env.NODE_ENV) === "production"
    ? { rejectUnauthorized: false }
    : false;

const sql = postgres(url, { max: 1, ssl });
const db = drizzle(sql);

console.log("Running database migrations…");
await migrate(db, {
  migrationsFolder: path.join(import.meta.dir, "migrations"),
});
console.log("Migrations complete.");

await sql.end();
process.exit(0);
