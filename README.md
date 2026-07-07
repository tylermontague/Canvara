# Canvara

*Every voter has a reason to support you. Canvara helps you find it.*

Political canvassing intelligence platform. Three components:
- `apps/field` — Expo (React Native) canvasser app
- `apps/console` — Next.js campaign console
- `apps/worker` — pipeline worker (ASR → extraction → belief engine)

See `BUILD_PLAN.md` for architecture decisions, milestones, and the full plan.
Requirements: `Canvara_Master_Requirements.docx` (in the Canvara Claude project).

## M0 Kickoff (first session on PC)

1. Clone this repo; run `npm install` (workspace root).
2. Create Supabase project (if not done) and copy credentials into `.env` (see `.env.example`).
3. Apply the schema: paste `supabase/migrations/00000000000001_schema_v1.sql` into the Supabase SQL Editor, or use `supabase db push` with the CLI.
4. Seed two test campaigns and verify RLS isolation (M0 exit test):
   a user in campaign A must not be able to read any row from campaign B.
5. Scaffold apps with current tooling (do this fresh in Claude Code rather than committing stale boilerplate):
   - `apps/console`: `npx create-next-app@latest`
   - `apps/field`: `npx create-expo-app@latest`
   - `apps/worker`: plain TypeScript service (`tsx`, one queue consumer)

## Model strategy

Haiku 4.5 for bulk extraction · Sonnet 4.6 for escalation and implementation ·
Fable 5 for prompts, synthesis, and oversight. Details in `BUILD_PLAN.md` §4.
