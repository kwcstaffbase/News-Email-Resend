import type { Config } from "drizzle-kit";

// Read the database connection string from the environment — required at migration time.
// Fail fast here rather than silently connecting to the wrong database.
// Set in .env for local dev (postgres://dev:dev@localhost:5432/dev);
// injected as a Kubernetes secret in staging/production deployments.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export default {
  // Use the PostgreSQL dialect — this project runs PostgreSQL 16 (see docker-compose.yml)
  dialect: "postgresql",
  // Source of truth for all table definitions; `drizzle-kit generate` diffs this against the live DB
  schema: "./src/db/schema.ts",
  // Directory where generated SQL migration files are written — committed to git alongside schema changes
  out: "./src/db/migrations",
  // Connection string used by drizzle-kit to introspect the live schema and apply migrations
  dbCredentials: { url },
} satisfies Config;
