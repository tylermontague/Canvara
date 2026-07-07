// @canvara/db — Supabase client factories and Database types.
//
// Two client shapes, matching the RLS design in schema v1:
//  - anon client: subject to RLS; every read/write is fenced to the signed-in
//    user's campaign. Use in the console (via @supabase/ssr) and field app.
//  - service client: bypasses RLS (worker + seed scripts only). Must always
//    set campaign_id explicitly and never join across tenants.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./types.js";

export type DbClient = SupabaseClient<Database>;

/** RLS-enforced client for a given user context (or pre-auth sign-in). */
export function createAnonClient(url: string, anonKey: string): DbClient {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. BYPASSES RLS — server-side only (worker, seeds, tests).
 * Never ship this key to a browser or the field app.
 */
export function createServiceClient(url: string, serviceRoleKey: string): DbClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Read Supabase env config in Node contexts (worker, scripts, tests). */
export function supabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy .env.example to .env at the repo root and fill in the project credentials.",
    );
  }
  return { url, anonKey, serviceRoleKey };
}
