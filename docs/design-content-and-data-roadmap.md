# Design note: data portal + content pipeline (post-pilot-prep roadmap)

Captured 2026-07-10 from TJ. Four ideas; three form a content pipeline
(narrative → messages → assets), one is data infrastructure (the portal).

## 1. Voter Data Portal — import that NEVER loses field intelligence — BUILT (M14)

Built 2026-07-11 (migrations 15+16, packages/shared/voter-merge.ts, M14 exit
test, console merge flow). The design landed on the insight below: the file
owns the file columns, the door owns everything else, so a re-import only
upserts file columns and leaves all derived data untouched — no per-field
provenance machinery needed. Phase-2 items still open: fuzzy match for
sources without a state voter ID, and filtering `active=false` voters out of
the analytics counts (only the map excludes them today).

The pilot-critical one. Today M1 import inserts voters; a real campaign
re-uploads its voter file constantly (weekly updates, new registrations,
absentee flags). A naive re-import would destroy everything we've learned:
door-observed attributes, belief states, signals/conversations, personal
context, geocodes, survey responses, spark usages.

**Core principle:** the voter file is ONE source among several. Canvassing,
commercial data appends, phone-match files all layer additional knowledge
onto the same voter. Re-importing any source must MERGE, never replace.

**The build:**
- Upsert-by-match-key merge engine (reuse parseCsv/suggestMapping/mapRows
  from M1, swap insert → upsert-preserve). Match key v1 = `external_id`
  (state voter ID). Sources without it → fuzzy name+address (Phase 2).
- Field precedence, encoded (extends the M6.5 door-trumps-file principle):
  door-observed > appended data > voter file. A re-import updates a file
  column only where the current value came from the file or is null —
  never clobbers a door correction.
- Voters dropped from the new file are marked `inactive`/`moved`, NEVER
  deleted (they carry canvass history).
- `imports` provenance table (source, uploaded_by, row counts, mapping,
  timestamp) + preview-before-commit: show "X new, Y updated, Z dropped"
  and a sample diff before applying.
- Don't re-geocode an already-geocoded voter unless the address changed.

**Exit test:** import file → canvass a voter (attributes, beliefs, signal,
personal_context) → re-import the same file → assert every derived datum
survives and file columns updated correctly.

## 2. Campaign Narrative — the candidate's persona, woven into every contact

New, and foundational to the content pipeline. The candidate has a story
and ethos — "I'm Nick Willis, spent my whole life in this part of town,
seen the problems we need to fix." A marketing persona that makes the
candidate easy to connect to. Right now every generated message is drafted
in isolation from evidence; nothing makes them sing from one songbook.

**The build:**
- `campaign_narrative` record (one per campaign), edited in the console:
  candidate name, one-line pitch, the core story (freeform), core values,
  signature issues, biographical "proof points" / hooks, and voice/tone.
- Injected as grounding context into EVERY generation prompt — Message Lab
  (all channels) and Workshop sparks. Output becomes coherent and
  on-brand across all touchpoints.
- Strengthens the canvass directly: the "I'm Nick Willis…" opener is a
  narrative-grounded spark. M12 sparks become narrative-aware.
- Possible guardrail addition: an on-narrative / off-narrative check — a
  message that contradicts the candidate's story is as bad as an
  alienating one.

## 3. Multi-channel messages by cohort — every stage of contact

Extends M7 Message Lab. Today messages are cohort/individual, goal-tagged,
but channel-agnostic. Add CHANNEL as a first-class dimension so a cohort
has a full message kit reused across the campaign's contact stages.

**The build:**
- `messages.channel`: canvass | sms | mail | email | digital_ad.
- Channel-aware generation constraints in the prompt: SMS short + punchy,
  mail longer + formal, digital ad = headline + body, canvass = spoken
  talking points. Narrative (#2) grounds all of them.
- Canvass channel relates to M12 sparks but is distinct: sparks OPEN a
  conversation (connection-first); canvass messages are the persuasion
  talking points once it's going. Decide: unify or keep as sibling roles.
- Console: a cohort "message kit" view — all channels in one place, each
  guardrailed and leadership-approved as today.

## 4. Template & asset library — plug messages in, build an inventory

The production layer (AdvocacyLab-style, per TJ: a template library for
creating campaign collateral). Turns approved messages (text) into
finished ASSETS (designed pieces) with an inventory. Biggest / furthest
out; Phase 3.

**The build (v1 sketch):**
- Template = a structured layout with slots per asset type: mail piece
  (headline / body / image / disclaimer), door hanger, digital ad
  (headline / body / CTA / image), SMS.
- Plug an approved (cohort × channel) message + narrative assets into a
  template → rendered preview (HTML/CSS → PDF for print, PNG for digital).
- Asset inventory with lifecycle status: draft → approved → in production
  → delivered. Track quantities per cohort/turf.
- Compliance baked in: every public asset carries the required disclaimer
  ("Paid for by…"). Non-negotiable slot in every template.
- Rendering: start with HTML→PDF ourselves; a design tool (e.g. Canva)
  integration could handle richer layouts later rather than us building a
  full layout engine.

## Recommended sequence

1. **Voter Data Portal (#1) — first.** It's a data-integrity gate, not a
   feature: the first real voter-file re-import would destroy field
   intelligence without it. Pilot-blocking.
2. **Campaign Narrative (#2)** — small, high-leverage; it's the input the
   whole content pipeline needs, and it immediately improves the canvass.
3. **Multi-channel messages (#3)** — consumes the narrative.
4. **Template & asset library (#4)** — consumes messages; largest, Phase 3.

Everything reuses existing machinery: #1 the M1 importer + M6.5 precedence,
#2/#3 the M7 messaging package + M12 sparks, #4 the M7 messages as input.
