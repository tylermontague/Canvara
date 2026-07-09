# Canvara security posture

Last reviewed: 2026-07-09. This document is the security overview for
certification and for anyone evaluating the platform. It describes the
threat model, the controls in place, the audit performed, and the residual
items on the roadmap.

Canvara handles **voter PII** (names, addresses, party, and inferred
political views) and **recorded conversations**. The data is legally
restricted (e.g. Arizona A.R.S. §39-121.03) and politically sensitive, so
the security model treats tenant isolation and auditability as
first-class, tested properties — not afterthoughts.

## Architecture & trust boundaries

| Component | Runs as | Trust |
|---|---|---|
| `apps/console` (Next.js) | User's session (anon key + JWT) | Untrusted browser; RLS-enforced |
| `apps/field` (Expo) | Canvasser's session (anon key + JWT) | Untrusted device; RLS-enforced |
| `apps/worker` (pipeline) | **service_role** (bypasses RLS) | Trusted server-only daemon |
| Supabase Postgres | — | The enforcement point (RLS) |

The **service_role key** is the only credential that bypasses Row Level
Security. It lives only in the worker's server environment and in
`.env` (gitignored). It is never shipped to the browser or a device — the
console and field app receive only the public anon URL + key
(`apps/console/next.config.ts` exposes `NEXT_PUBLIC_*` exclusively;
verified in audit).

## Controls in place

### 1. Multi-tenant isolation (Row Level Security)
Every domain table carries `campaign_id` and has an RLS policy fencing it
to `current_campaign_id()` — the caller's campaign, derived from their
JWT via a `SECURITY DEFINER` function over `profiles`. A user can never
read or write another campaign's rows. Proven continuously by the **M0
exit test** (cross-campaign SELECT/INSERT/UPDATE/DELETE all denied) and
reinforced in every later milestone's isolation test.

- `SECURITY DEFINER` tenancy functions (`current_campaign_id`,
  `current_role_in_campaign`) pin `search_path = ''` and schema-qualify
  every reference (migration 14), closing the "mutable search_path"
  privilege-escalation class flagged by Supabase's advisor.
- `profiles` has **no** INSERT/UPDATE/DELETE policy → users cannot change
  their own role or campaign (no privilege escalation). Profiles are
  provisioned by the service role only.
- Sensitive mutations are additionally role-gated in the database, not
  just the UI: campaign settings (admin/manager), message approval and
  workshop question/spark approval (admin/manager/field_director). A
  canvasser calling the approval path directly is denied by RLS — proven
  in the M7 and M12 exit tests.

### 2. Append-only audit trail
`audit_log` records pipeline actions, debrief corrections, settings
changes, and message approvals. It is **append-only**: members may INSERT
and SELECT, but there is no UPDATE or DELETE policy, so the database
denies any attempt to rewrite or erase history (migration 14). Verified
by the **M13 security exit test** (member update/delete touch zero rows;
the row is provably unchanged; cross-tenant tamper denied).

### 3. Immutable recordings & data retention
Conversation audio is stored in a private bucket, path-fenced to the
campaign (`{campaign_id}/{conversation_id}.m4a`). There is **no** storage
UPDATE/DELETE policy for members — recordings are immutable from the
field. A per-campaign retention sweep (worker, service role) purges raw
audio + transcripts past `retention_days`, keeping only derived signals,
and audits every purge (M6). Durable personal context is stored on the
signal so it survives the purge without retaining raw transcripts.

### 4. Injection & XSS
- **XSS:** audited clean. No `dangerouslySetInnerHTML`, `innerHTML`,
  `eval`, `document.write`, or `insertAdjacentHTML` anywhere. All DB
  strings (voter names, addresses, transcripts, survey/spark/message text)
  render through auto-escaping JSX. The MapLibre popup uses `.setText()`
  (textContent), never `.setHTML()`.
- **SQL injection:** no dynamic SQL. All DB access is parameterized
  through the Supabase client / typed RPC. `correlate_voter` takes typed
  params only.
- **CSV injection:** the Census geocode request builder
  (`buildCensusBatchCsv`) escapes quotes and strips newlines from every
  address field. Voter-file CSVs are import-only (parsed, never re-emitted
  as a downloadable spreadsheet), so spreadsheet-formula injection has no
  sink today.
- **Log injection:** untrusted text (external-service error bodies, DB
  errors, LLM-extracted labels) is passed through `sanitizeForLog()` —
  strips CR/LF and control characters, bounds length — before any worker
  log call, so forged log lines can't be smuggled into an aggregator (M13).
- **Open redirect:** all redirects target static literals; all
  `href`/`src` are same-origin id-based paths. No user-controlled
  redirect target.

### 5. Secret handling
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, and
`SUPABASE_DB_URL` are presence-checked but never logged, never sent to a
client, and absent from all browser/device code. `.env` and `*.log` are
gitignored; only `.env.example` (empty values) is committed. Voter-file
CSVs are gitignored (PII). Audited clean.

### 6. HTTP security headers (console)
`apps/console/next.config.ts` sets, on every response:
- **Content-Security-Policy** — `default-src 'self'`; external origins
  whitelisted to exactly Supabase (auth/REST/realtime) and OpenStreetMap
  raster tiles; `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`.
- **X-Frame-Options: DENY** (clickjacking), **X-Content-Type-Options:
  nosniff**, **Referrer-Policy: strict-origin-when-cross-origin**,
  **Permissions-Policy** disabling camera/mic/geolocation,
  **Strict-Transport-Security** (2y, includeSubDomains, preload).

### 7. AI-specific controls
- Every generated voter-facing message runs a **Fable-5 guardrail**
  (alienation / partisan tone / overclaiming / over-personalization); a
  model refusal fails safe to `flag`, never silent-pass (M7).
- Every drafted **poll question** runs a **neutrality guardrail** — a
  leading or loaded question is flagged before it can bias the data it
  collects (M12).
- Nothing AI-drafted reaches a voter or a canvasser without explicit
  **leadership approval** (DB-enforced).

## Audit performed (2026-07-09)
A full-surface review across the console, field app, worker, database, and
LLM pipeline covering: injection/XSS sinks, open redirect, secret leakage,
log injection, RLS coverage, `SECURITY DEFINER` search_path, audit
immutability, and header posture. Findings were remediated in migration
14, the worker log sanitizer, and the console headers, and locked in by
the M13 exit test. No cross-tenant, XSS, secret-exposure, or SQL-injection
vulnerability was found.

## Residual items / roadmap
These are known, accepted, and scheduled — none is an active
vulnerability:

1. **CSP `script-src 'unsafe-inline'`.** Next's hydration bootstrap ships
   inline. The app has zero XSS sinks, so this is a defense-in-depth gap,
   not an exploit path. Hardening to nonce-based CSP is a follow-up.
2. **Server-action error messages.** Console server actions surface raw
   DB/LLM error strings to the authenticated user. Low-risk info
   disclosure (same-campaign, authenticated); genericizing user-facing
   errors while logging detail server-side is a follow-up.
3. **Rate limiting / abuse.** Auth throttling is handled by Supabase.
   Application-level rate limits on generation endpoints (LLM cost abuse)
   are not yet implemented.
4. **Pen test & dependency scanning.** A third-party penetration test and
   automated dependency-vulnerability scanning (e.g. `npm audit` in CI)
   should run before the live pilot.
5. **MFA for leadership accounts.** Supabase supports it; enrolment policy
   is a deployment-time decision.

## How to re-verify
```
npm run test:m0     # cross-campaign RLS isolation
npm run test:m13    # append-only audit, pinned functions, log sanitizer
```
Both run against live infrastructure and must pass before any release.
