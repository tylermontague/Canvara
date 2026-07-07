// Apply a SQL migration file to the Supabase project via SUPABASE_DB_URL.
// Usage: node scripts/db-apply.mjs supabase/migrations/<file>.sql
// Idempotence is the migration's responsibility (create or replace / if not
// exists); this runner just executes the file in one transaction.

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config();

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/db-apply.mjs <path-to-sql-file>");
  process.exit(1);
}
if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL missing from .env");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`applied: ${file}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
