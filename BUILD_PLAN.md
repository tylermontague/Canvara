# Canvara Build Plan

Master engineering plan. Companion to `Canvara_Master_Requirements.docx` (requirement IDs referenced throughout). Drop this file in the repo root.

---

## 1. Architecture Decision Record

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| ADR-1 | Capture hardware | Phone-first; Bluetooth audio-source abstraction for future wearables | Zero hardware cost for pilot; swap in Omi/Plaud later without rearchitecting FA-4 |
| ADR-2 | ASR | Cloud (Deepgram Nova w/ diarization; AssemblyAI as fallback) | Fastest to build, best accuracy, easy Spanish add in Phase 2. Revisit on-device Whisper at scale |
| ADR-3 | Language | TypeScript everywhere | Solo developer; one mental model. Bayesian Beta updates are simple math — no Python until MRP (Phase 2) |
| ADR-4 | Backend | Supabase (Postgres + RLS + Auth + Storage + Edge Functions) | Multi-tenant isolation enforced at DB level via RLS; auth and storage included |
| ADR-5 | Pipeline compute | Dedicated worker service (Railway or Fly.io), TypeScript | ASR orchestration + LLM extraction are too heavy for edge functions |
| ADR-6 | Consent | Universal "we use automated notes" disclosure, logged per conversation; per-state config flag for stricter modes | One workflow everywhere; legal review before deploying outside AZ |
| ADR-7 | Tenancy | Multi-tenant schema from day one; pilot runs one campaign | Firewall architecture (CX: hard isolation) costs little now, expensive to retrofit |
| ADR-8 | LLM strategy | Tiered: Haiku 4.5 bulk → Sonnet 4.6 escalation → Fable 5 synthesis/oversight | Cost efficiency at volume without sacrificing quality where it matters |

## 2. Repositories & Structure

Single monorepo: `canvara`

```
canvara/
├── apps/
│   ├── field/          # Expo (React Native) — canvasser app (FA-*)
│   ├── console/        # Next.js — campaign console (CC-*)
│   └── worker/         # Pipeline worker (IE-*): queue consumer, ASR, extraction, belief engine
├── packages/
│   ├── db/             # Supabase schema, migrations, generated types
│   ├── shared/         # SignalObject types, issue taxonomy, belief math, zod schemas
│   └── prompts/        # Versioned extraction prompts (Fable-authored, Haiku-executed)
├── supabase/           # config, migrations, edge functions, RLS policies
└── BUILD_PLAN.md
```

## 3. Core Data Flow (MVP loop)

```
Field app records audio (offline-safe)
  → upload to Supabase Storage (conversations bucket, campaign-scoped path)
  → row inserted in `conversations` (status: uploaded)
  → worker picks up job → Deepgram ASR + diarization → transcript stored
  → GPS/timestamp correlation to voter record (canvasser override wins)
  → Claude Haiku extraction → SignalObject written to `signals`
  → confidence < 0.6 → Sonnet retry → still < 0.6 → `review_queue`
  → canvasser debrief confirm/correct (FA-5) updates signal, logs training data
  → console dashboards read aggregated views
```

## 4. LLM Model Strategy (ADR-8)

| Task | Model | Notes |
|------|-------|-------|
| Per-conversation signal extraction (bulk) | claude-haiku-4-5 | Structured output against 11-field taxonomy; pennies per conversation |
| Debrief summary generation (FA-5) | claude-haiku-4-5 | Latency-sensitive; must return in ~2–3s |
| Low-confidence re-extraction | claude-sonnet-4-6 | Triggered at confidence < 0.6 |
| Message generation (Phase 3, CC-5) | claude-sonnet-4-6 | Evidence-tagged templates |
| Prompt engineering & versioning | claude-fable-5 | Prompts live in `packages/prompts`, versioned; every signal records prompt version |
| Aggregate synthesis, guardrail checks (ceiling-of-persuasion, narrative contamination) | claude-fable-5 | Low volume, high stakes |
| Review-queue adjudication assist | claude-fable-5 | Helps human coder; human decision is final |

Development workflow: Fable 5 for architecture and code review; Sonnet 4.6 for routine implementation in Claude Code.

## 5. Milestones

### M0 — Foundation (repo, auth, tenancy)
- Monorepo scaffold, Supabase project, CI basics
- Schema v1 applied (`schema.sql`), RLS policies on every table
- Auth: email/password + roles (admin, manager, field_director, organizer, canvasser)
- **Exit test:** two campaigns seeded; user in campaign A provably cannot read any row from campaign B

### M1 — Voter data & walk lists (CC-9 partial, CC-4 minimal)
- Voter file CSV import with column mapping (console)
- Walk list builder: filter voters, assign to canvasser, order stops
- **Exit test:** import 5k-row test voter file; build and assign a walk list

### M2 — Field app core (FA-1, FA-2, FA-3 tier 1, FA-4, FA-7)
- Auth, shift join, walk list + map
- Pre-door briefing tier 1 (identity from voter file), <2s from local store
- One-tap capture: audio + GPS/timestamp, consent disclosure logging (ADR-6)
- Offline-first: SQLite queue, background upload
- **Exit test:** airplane-mode canvass of 5 doors; all data syncs on reconnect

### M3 — Pipeline (IE-1..IE-4)
- Worker: storage-triggered job queue, idempotent
- Deepgram ASR + diarization; WER spot-check harness
- GPS-timestamp voter correlation w/ manual override precedence
- Haiku extraction → SignalObject; Sonnet escalation path; prompt versioning
- **Exit test:** recorded test conversation → correct signals on all 11 fields within 10 min (CX-4)

### M4 — Debrief & review (FA-5, IE-8)
- AI summary + tappable confirm/correct in <45s
- Review queue UI in console; corrections logged as training data
- **Exit test:** correction round-trips into the stored signal and audit log

### M5 — Console intelligence (CC-1 partial, CC-2 partial)
- Ambient Pulse tier 1 (support distribution, top issues, trend line)
- Issue Salience Tracker; voter cards with transcript link
- Insufficient-sample graying per Ambient Polling thresholds
- **Exit test:** 100 seeded conversations render correct aggregates and drill-down

### M6 — Pilot hardening
- Belief engine v1 (Beta updates + decay) feeding briefing tier 2 (FA-3)
- Audit logs (CX-5), retention config (CX-2), metrics/monitoring
- **Exit:** pilot-ready for first 2026 race

Phase 2 (alerts, MRP, remaining views, walk-list optimization) and Phase 3 (Message Craft, channel mix, integrations) follow per the requirements doc sequencing.

## 6. External Services Checklist

- [ ] Supabase project (org: Canvara)
- [ ] Anthropic API key (usage tiers configured)
- [ ] Deepgram account + API key
- [ ] Expo/EAS account (builds + OTA updates)
- [ ] Vercel (console hosting)
- [ ] Railway or Fly.io (worker)
- [ ] Mapping: MapLibre + free tiles for pilot (avoid Google Maps SDK cost)

## 7. Open Items Carried Forward

- Legal review of universal-disclosure sufficiency in two-party states (pre-expansion, not pre-pilot)
- Pilot race selection (drives voter file acquisition)
- Entity formation → contracts for pilot data-sharing terms
