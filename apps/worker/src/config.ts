// Worker configuration. Credentials come from the repo-root .env.
// The worker uses the service_role key and bypasses RLS by design — it must
// always set campaign_id explicitly and never join across tenants.

import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServiceClient, type DbClient } from "@canvara/db";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

export interface WorkerConfig {
  db: DbClient;
  deepgramKey: string;
  pollIntervalMs: number;
}

export function loadConfig(): WorkerConfig {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env");
  }
  if (!deepgramKey) {
    throw new Error("DEEPGRAM_API_KEY missing from .env — required for transcription (IE-2)");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing from .env — required for extraction (IE-4)");
  }
  return {
    db: createServiceClient(url, serviceRoleKey),
    deepgramKey,
    pollIntervalMs: parseInt(process.env.WORKER_POLL_MS ?? "5000", 10),
  };
}
