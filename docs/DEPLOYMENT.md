# Canvara deployment checklist (local → hosted pilot)

The steps to take Canvara from "runs on TJ's machine" to a hosted pilot.
Nothing here is built yet — this is the runbook for when we deploy.
Cross-refs: `BUILD_PLAN.md` §6 (services), `docs/SECURITY.md` (residuals).

## 1. Production Supabase project

- [ ] **Provision PostGIS in a dedicated `extensions` schema, NOT `public`.**
  On the current dev project PostGIS lives in `public`, which is what
  puts `spatial_ref_sys` in the API-exposed schema and triggers the
  Supabase "table publicly accessible" advisory (see SECURITY.md). On a
  fresh project, install it clean:
  ```sql
  create schema if not exists extensions;
  create extension postgis with schema extensions;
  ```
  **Migration gotcha this creates:** our pinned-`search_path` SECURITY
  functions currently qualify PostGIS calls as `public.st_*`
  (migration 16 `correlate_voter`) because PostGIS is in `public` here. If
  PostGIS is in `extensions` on prod, those references must become
  `extensions.st_*` (and any `::public.geography` cast → `::extensions.geography`).
  Geometry/geography *column types* in migration 1 are unqualified and
  resolve via search_path (Supabase's default search_path includes
  `extensions`), so they're fine — only the `search_path = ''` functions
  need the qualified names updated. Plan a small "prod PostGIS schema"
  migration variant, or template the schema via env.
- [ ] Apply all migrations in order (`scripts/db-apply.mjs`, or Supabase
  migration tooling) against the prod DB URL.
- [ ] Re-run the RLS audit (every base table in `public` has
  `relrowsecurity = true`); confirm `spatial_ref_sys` is no longer in
  `public` (it moved with the extension) — the advisory should clear.
- [ ] Seed the issue taxonomy (migration 6) and create the real campaign +
  first leadership user; author the **campaign narrative** (M15) before
  generating any messaging.
- [ ] Set `retention_days` / `consent_mode` per the pilot state's law.

## 2. Hosting (BUILD_PLAN §6)

- [ ] **Console → Vercel.** Set env: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` only (never the service key). Confirm
  the security headers (next.config.ts) ship in prod, and that the CSP
  `connect-src` points at the *prod* Supabase origin.
- [ ] **Worker → Railway or Fly.** Set env: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`.
  This is the only place the service-role key lives. Always-on so the
  transcribe→extract→belief + geocode + retention sweeps run continuously.
- [ ] **Field app → EAS build.** This is also what unblocks real
  on-device testing (Expo Go can't run our SDK). A development build (or
  TestFlight for iOS) embeds the SDK; register test devices / Apple
  credentials. Re-enable `typedRoutes` once expo-router is hoisted in the
  build, or leave off — routing is unaffected.
- [ ] Point the field app + console at the prod Supabase project (their
  own env), not the dev one.

## 3. Security follow-ups (from SECURITY.md residuals)

- [ ] Acknowledge or resolve the `spatial_ref_sys` advisory in the
  Supabase dashboard for the dev project (the prod project fixes it via
  the dedicated-schema install above).
- [ ] Harden CSP to nonce-based `script-src` (drop `'unsafe-inline'`).
- [ ] Genericize user-facing server-action error strings; log detail
  server-side.
- [ ] Add `npm audit` (dependency scanning) to CI; run a third-party pen
  test before go-live.
- [ ] Enable MFA for leadership accounts (Supabase Auth).
- [ ] Application-level rate limiting on the LLM generation endpoints.

## 4. Data & pilot prep (BUILD_PLAN §7 — TJ's decisions)

- [ ] Pilot race selected; real voter file acquired (legally, per A.R.S.).
- [ ] First import via the data portal (M14); worker geocodes it; verify
  map coverage.
- [ ] Legal review of the universal-disclosure wording for the pilot
  state; entity formation + data-sharing terms.

## 5. Smoke test in prod
- [ ] Cross-tenant RLS holds (run the M0 assertions against prod).
- [ ] One real end-to-end: import → walk a door on a real device →
  transcribe/extract → see the signal + debrief in the console.
