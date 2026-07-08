# Design note: "How are we doing" + "What-if" scenario tool (M9 candidate)

Captured 2026-07-08 from TJ; build next session.

## The idea

Two additions to the Voter Intelligence Lab:

**1. "How are we doing"** — current standing, broken out by cohort:
- Polling results (our door polls + support signals) per cohort block
- Aggregable up dimensions: all women, all men, all 65+, etc. (not just
  saved cohort blocks — any dimension rollup)
- Regional breakouts where data supports it (precinct, zip)

**2. "What-if" mode** — an electorate simulator for strategy:
- Model: registered voters × per-segment turnout assumption × per-segment
  support split → projected vote margin
- Sliders/inputs per segment: turnout % and our-share %
- Baseline pre-filled from historical turnout (turnout_by_election) and
  our current support signals per segment
- Outputs: "win/lose by N votes", and inverse solving — "to win, you need
  ≥60% of 65+ voters at ≥48% turnout" style statements
- The strategic purpose: pick the voter *markets* where traction is
  realistic and decisive, and let that choice drive resource allocation
  and which public-facing messages get emphasized. Feed chosen target
  segments back into cohort blocks → Message Lab.

## What we already have (M6.5/M8 groundwork)

- Cohort blocks + `evaluateCohort` (demographic AND issue-stance segments,
  door-observed attributes override the file)
- `COHORT_DIMENSIONS` — the aggregation axes for "all women / all men"
- `turnout_by_election` view + cycle classification (midterm vs
  presidential baselines) — per-segment historical turnout is a GROUP BY
  away
- Support per segment: `evaluateCohort` already returns support
  distribution from latest signals
- `survey_responses` (door polls) — joinable to voters → cohort breakouts
- `voters.precinct` / `zip` for regional rollups

## Needs building

- Per-segment turnout baselines (turnout_by_election grouped by voter
  segment, not just campaign)
- Sample-size discipline: segment poll/support numbers must gray out below
  thresholds (reuse PULSE_MIN_SAMPLE approach) — a what-if tool that lets
  you slide a 6-person sample to victory is a lie machine
- Scenario model in shared (pure math, exit-testable exactly): segments
  partition the electorate (avoid double-count when segments overlap —
  either enforce partitions by one dimension at a time, or apply
  overlap-aware residual "everyone else" bucket)
- Two-candidate margin assumption v1 (our share vs. not-ours); undecideds
  allocated by slider or held out
- `scenarios` table (campaign, name, assumptions jsonb, created_by) so a
  strategy can be saved, compared, and revisited
- Inverse solver: hold all else at baseline, solve the one variable
  ("required share of 65+ at 48% turnout to reach 50%+1")
- Console UI: /lab/scenarios — standing tables by dimension + the
  simulator with sliders + saved scenarios
- Regional: standing by precinct (map choropleth later; table first)

## Decisions (2026-07-08, built as M9)

1. Win number: BOTH — derived from the scenario's own turnout assumptions
   by default, with an optional user-entered expected-electorate override
   that anchors the win bar and the opponent's pool.
2. External poll numbers: manual entry per segment — a "poll prior" column
   beside our door data (poll_priors table, one current prior per
   campaign/dimension/segment; re-entry replaces).
3. Placement: new /lab/scenarios page holding both the standing tables and
   the simulator, linked from /lab and the app header.

Implementation: packages/shared/src/scenarios.ts (standing fetch, pure
projection math, inverse solvers), migration 10 (scenarios + poll_priors),
tests/m9/scenarios.test.ts, console app/lab/scenarios/.
