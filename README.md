# Canvara

*Every voter has a reason to support you. Canvara helps you find it.*

Political canvassing intelligence platform. Three components:
- `apps/field` — Expo (React Native) canvasser app
- `apps/console` — Next.js campaign console
- `apps/worker` — pipeline worker (ASR → extraction → belief engine)

Shared workspace packages: `packages/db` (Supabase clients + types),
`packages/shared` (roles, SignalObject types), `packages/prompts` (versioned
extraction prompts).

See `BUILD_PLAN.md` for architecture decisions, milestones, and the full plan.
Requirements: `Canvara_Master_Requirements.docx` (in the Canvara Claude project).

## Setup

1. `npm install` at the repo root (npm workspaces).
2. Copy `.env.example` to `.env` at the repo root and fill in the Supabase
   credentials (dashboard → Settings → API). Never commit `.env`.
3. The schema (`supabase/migrations/00000000000001_schema_v1.sql`) must be
   applied to the Supabase project (SQL Editor or `supabase db push`).

## Commands

| Command | What it does |
|---|---|
| `npm run dev:console` | Next.js console at localhost:3000 |
| `npm run dev:field` | Expo dev server for the field app |
| `npm run dev:worker` | Pipeline worker (stub until M3) |
| `npm run typecheck` | Typecheck every workspace |
| `npm run gen:types` | Regenerate `packages/db/src/types.ts` from the live DB (needs `SUPABASE_DB_URL`) |
| `npm run seed:m0` | Seed two test campaigns + one user each (idempotent) |
| `npm run test:m0` | M0 exit test: prove cross-campaign RLS isolation |
| `npm run test:m1` | M1 exit test: 5k-row voter file import + walk list build/assign |
| `npm run test:m2` | M2 exit test: airplane-mode 5-door canvass syncs on reconnect |
| `npm run test:m3` | M3 exit test: scripted conversation → correct signals on all 11 fields |
| `npm run test:m4` | M4 exit test: debrief correction round-trips into signal + audit log |
| `npm run test:m5` | M5 exit test: 100 seeded conversations render correct aggregates |
| `npm run test:m6` | M6 exit test: belief engine, retention purge, settings RLS, health |
| `npm run test:m65` | M6.5 exit test: cohorts, door polls, personal context, precedence |
| `npm run test:m7` | M7 exit test: Message Lab drafting + Fable guardrail catches alienation |
| `npm run test:m8` | M8 exit test: district map, turnout math, contact coverage, signs/events |
| `npm run test:m9` | M9 exit test: standing by dimension, what-if projection + inverse solvers |
| `npm run test:m10` | M10 exit test: Census geocoding sweep — real addresses become map dots |
| `npm run test:m11` | M11 exit test: cold-test protocol, issue rankings, pre/post persuasion delta |
| `npm run test:m12` | M12 exit test: workshop drafting, neutrality guardrail, spark effectiveness |
| `npm run test:m13` | Security exit test: append-only audit log, pinned RLS functions, log sanitizer |
| `npm run test:m14` | M14 exit test: voter re-import merges, never destroys field intelligence |
| `npm run test:m15` | M15 exit test: campaign narrative shapes generated messages + sparks |

## M0 exit test

`seed:m0` creates Campaign A and Campaign B, one user in each, and rows in
`voters`, `conversations`, and `signals` for both. `test:m0` then signs in as
each user and proves (against service-role ground truth) that:

- unfiltered SELECTs return only own-campaign rows,
- SELECTs filtered to the other campaign return zero rows,
- direct fetches of known other-campaign row ids return nothing,
- cross-campaign INSERT is rejected, UPDATE/DELETE touch zero rows,
- an unauthenticated client reads nothing at all.

## Model strategy

Haiku 4.5 for bulk extraction · Sonnet 4.6 for escalation and implementation ·
Fable 5 for prompts, synthesis, and oversight. Details in `BUILD_PLAN.md` §4.
