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

// ---- Security headers (certification: defense-in-depth over the app's
// already-clean render path). The CSP whitelists exactly the two external
// origins the app needs: Supabase (auth/REST/realtime) and OpenStreetMap
// raster tiles for the district map. Everything else is same-origin. ----
const isDev = process.env.NODE_ENV !== "production";
const supabaseOrigin = url ? new URL(url).origin : "";
const OSM_TILES = "https://tile.openstreetmap.org";

const csp = [
  `default-src 'self'`,
  // Next.js hydration ships an inline bootstrap; dev/HMR additionally
  // needs eval. Inline styles are required by Tailwind + MapLibre.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${OSM_TILES}`,
  `font-src 'self' data:`,
  // Supabase over https + realtime websocket; OSM in case tiles fetch.
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^https/, "wss")} ${OSM_TILES}`.trim(),
  `worker-src 'self' blob:`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  env: publicEnv,
  // Workspace packages ship raw TypeScript; Next compiles them.
  transpilePackages: ["@canvara/db", "@canvara/shared", "@canvara/messaging", "@canvara/prompts"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
