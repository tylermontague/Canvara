import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "node:path";

// Single source of truth for credentials is the repo-root .env (never
// committed). Loaded here and re-exposed under the NEXT_PUBLIC_ names the
// browser client needs. The service_role key is deliberately NOT exposed.
config({ path: path.resolve(process.cwd(), "../../.env") });

const publicEnv: Record<string, string> = {};
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url) publicEnv.NEXT_PUBLIC_SUPABASE_URL = url;
if (anonKey) publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;

const nextConfig: NextConfig = {
  env: publicEnv,
  // Workspace packages ship raw TypeScript; Next compiles them.
  transpilePackages: ["@canvara/db", "@canvara/shared"],
};

export default nextConfig;
