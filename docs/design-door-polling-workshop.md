# Design note: door polling instruments + canvasser workshop (M11/M12)

Captured 2026-07-08 from TJ. The ask, verbatim in spirit: craft relevant
polling questions for canvassers; craft discussion topics that spark
conversations and emotional connections; cold-test vote intention; learn
how voters RANK issues by importance; and measure whether discussion
changes the cold-test answer.

## The loop this creates

  Scenarios shows a data gap ──► Workshop drafts questions/topics
        ▲                                        │
        │                                        ▼
  delta analytics ◄── canvasser runs cold-ask → discussion → re-ask

The pre/post delta is the strategic prize: it measures *door-level
persuasion per segment and per topic* — exactly the number the what-if
share sliders currently ask the user to guess. Topics that move cold
answers get promoted; ones that don't get retired.

## M11 — polling instruments (schema + field + analytics)

- `survey_questions.kind`: 'choice' (today's) | 'intention' (cold test,
  standard options: our candidate / opponent / undecided / refuse) |
  'rank' (rank top-N issues from the campaign's issue list).
- Pre/post protocol: `survey_responses.phase` check ('pre','post',
  'only') — 'only' preserves today's single-ask behavior. Unique key
  becomes (question_id, conversation_id, phase). Rank answers stored as
  ordered jsonb array of issue ids.
- Field app flow: cold bookend (intention + optional rank, ~10 seconds)
  BEFORE the conversation; re-ask AFTER, in the existing poll phase.
  Design rule: the bookends must stay nearly invisible — the human
  conversation in the middle is the product, not the clipboard.
- Offline: extend QueuedCapture.surveyResponses with phase; sync port
  unchanged otherwise.
- Analytics (shared, exact-math testable like scenarios.ts):
  - stated issue ranking per segment (Borda or mean-rank), beside
    ambient salience — disagreement between stated and spontaneous is a
    first-class insight, surface it.
  - persuasion delta: % of pre='undecided'/opponent that move toward us
    post, by segment; sample-graying discipline applies (deltas on tiny
    n are noise).
  - feed scenarios: measured movability per segment shown next to the
    share slider ("door conversations move X% of this segment's
    undecideds, n=Y").
- Console: /lab/scenarios or admin survey page grows kind-aware
  authoring; delta table in the lab.

## M12 — the workshop (AI drafting with guardrails)

- Reuse packages/messaging structure: Sonnet drafts, Fable guardrails,
  leadership approval before anything reaches a canvasser.
- Two artifact types:
  1. Poll questions — grounded in data gaps (segments with
     insufficientSample in standing, issues with thin belief coverage).
     Guardrail: NEUTRALITY — reject leading/push-poll wording; a biased
     question poisons every downstream number (same honesty discipline
     as sample graying).
  2. Discussion topics / conversation sparks — canvasser-facing talk
     openers per cohort (and per voter, using personal_context +
     beliefs). Goal: emotional connection first, persuasion second.
     Guardrail: existing alienation/over-personalization rubric
     ("remembered, not surveilled").
- Approved questions land in survey_questions; approved topics land in
  the field briefing (tier-2 card: "SPARKS").
- Topic performance: join topics used (canvasser marks which spark they
  used at debrief — one tap) to pre/post deltas → per-topic movability.

## Open questions

1. Does the canvasser choose which spark they used at debrief (one-tap,
   feeds per-topic deltas), or do we skip attribution in v1?
2. Intention question: campaign-configurable options or fixed
   candidate/opponent/undecided?
3. Rank question length: top-3 of 5 curated issues is fast at the door;
   full taxonomy is too much. Curated per campaign in admin?
