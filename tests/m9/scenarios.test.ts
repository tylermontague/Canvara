// M9 exit test: "how are we doing" standing + what-if scenarios.
//  - the scenario model is exact algebra: projections, the expected-
//    electorate override, and both inverse solvers verified to the vote
//  - standing partitions the electorate (segments always sum to the whole)
//    with exact per-segment turnout from the seeded vote history
//  - seeded support signals move one segment's numbers by exact deltas;
//    small samples are grayed, never percentaged
//  - poll priors round-trip (insert + replace) and scenarios save/load;
//    campaign B sees none of it
//
// Run after m0–m8 (needs M1's voters; re-seeds M8's vote history itself).

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type Json,
  type TablesInsert,
} from "@canvara/db";
import {
  projectScenario,
  solveRequiredShare,
  solveRequiredTurnout,
  fetchStanding,
  fetchSurveyBreakouts,
  SEGMENT_MIN_SAMPLE,
  UNKNOWN_SEGMENT,
  type SegmentAssumption,
  type SegmentStanding,
  type ScenarioAssumptions,
} from "@canvara/shared";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const SUPPORT_MARKER = "m9-support/"; // audio_path prefix → teardown marker
const PRIOR_SOURCE = "M9 test poll";
const SCENARIO_NAME = "M9 test scenario";
const CYCLE_YEAR = 2026; // midterm → last similar general is 2022

// Same seeding as M8 (idempotent re-application keeps the suites in step).
const SEEDED = 200;
const VOTED_2024 = 120;
const VOTED_2022 = 80;

// Seeded support signals for one segment: 16 republican voters untouched by
// any earlier suite (M1 index ≥ 300).
const SEED_SUPPORT = [
  ...Array<string>(6).fill("strong_support"),
  ...Array<string>(4).fill("lean_support"),
  ...Array<string>(2).fill("strong_oppose"),
  ...Array<string>(2).fill("lean_oppose"),
  ...Array<string>(2).fill("undecided"),
];
const SEED_SUPPORTIVE = 10;
const SEED_OPPOSED = 4;
const SEED_UNDECIDED = 2;

let campaignA: string;
let canvasserId: string;
let manager: DbClient;
let clientB: DbClient;
let seededVoterIds: string[] = []; // the 200 with vote history
let partyBefore: SegmentStanding; // republican segment before support seeding

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

function republicanSegment(segments: SegmentStanding[]): SegmentStanding {
  const seg = segments.find((s) => s.key === "republican");
  assert.ok(seg, "party standing has a republican segment");
  return seg!;
}

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;
  canvasserId = await ensureCanvasser(service, campaignA);

  // Teardown prior M9 artifacts (signals cascade from conversations).
  {
    const { error } = await service
      .from("conversations")
      .delete()
      .like("audio_path", `${SUPPORT_MARKER}%`);
    if (error) throw new Error(`teardown conversations: ${error.message}`);
  }
  await service.from("scenarios").delete().eq("campaign_id", campaignA).eq("name", SCENARIO_NAME);
  await service.from("poll_priors").delete().eq("campaign_id", campaignA).eq("source", PRIOR_SOURCE);

  // Vote history on the first 200 M1 voters, exactly as M8 seeds it.
  const { data: voters, error: votersErr } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .order("external_id")
    .limit(SEEDED);
  if (votersErr) throw new Error(votersErr.message);
  if ((voters?.length ?? 0) < SEEDED) throw new Error("Run `npm run test:m1` first.");
  seededVoterIds = voters!.map((v) => v.id);
  for (let i = 0; i < SEEDED; i++) {
    const voteHistory = {
      "2024_general": i % 10 < 6, // 120 true
      "2022_general": i % 10 < 4, // 80 true
    };
    const { error } = await service
      .from("voters")
      .update({ vote_history: voteHistory as unknown as Json })
      .eq("id", seededVoterIds[i]);
    if (error) throw new Error(`seed vote history ${i}: ${error.message}`);
  }

  manager = await signIn(USER_A.email, USER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);

  // Party standing BEFORE the support seeding — deltas are asserted later.
  const standingBefore = await fetchStanding(manager, "party", CYCLE_YEAR);
  partyBefore = republicanSegment(standingBefore.segments);

  // 16 registered-REP voters no earlier suite has touched (index ≥ 300).
  const { data: repPool, error: repErr } = await service
    .from("voters")
    .select("id, party")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .order("external_id")
    .range(300, 999);
  if (repErr) throw new Error(repErr.message);
  const repVoters = (repPool ?? []).filter((v) => v.party === "REP").slice(0, SEED_SUPPORT.length);
  if (repVoters.length < SEED_SUPPORT.length) throw new Error("not enough REP voters to seed");

  const conversations: TablesInsert<"conversations">[] = [];
  const signals: TablesInsert<"signals">[] = [];
  for (let i = 0; i < SEED_SUPPORT.length; i++) {
    const convoId = randomUUID();
    conversations.push({
      id: convoId,
      campaign_id: campaignA,
      canvasser_id: canvasserId,
      voter_id: repVoters[i].id,
      voter_id_manual: true,
      audio_path: `${SUPPORT_MARKER}${convoId}.m4a`,
      recorded_at: new Date().toISOString(),
      contact_result: "full_conversation",
      status: "extracted",
    });
    signals.push({
      campaign_id: campaignA,
      conversation_id: convoId,
      support_level: SEED_SUPPORT[i],
      top_issues: [],
      issue_sentiment: {} as Json,
      provenance: {} as Json,
      emotional_valence: "neutral",
      persuadability: "persuadable",
      confidence_score: 0.9,
      model_used: "m9-seed",
      prompt_version: "m9-seed",
    });
  }
  {
    const { error } = await service.from("conversations").insert(conversations);
    if (error) throw new Error(`seed conversations: ${error.message}`);
  }
  {
    const { error } = await service.from("signals").insert(signals);
    if (error) throw new Error(`seed signals: ${error.message}`);
  }
});

// ---------- Pure scenario math ----------

const SEG_A: SegmentAssumption = { key: "a", registered: 1000, turnoutPct: 50, ourSharePct: 60 };
const SEG_B: SegmentAssumption = { key: "b", registered: 2000, turnoutPct: 40, ourSharePct: 40 };

test("projection: exact votes, margin, and win bar from the assumptions", () => {
  const p = projectScenario([SEG_A, SEG_B]);
  // A casts 500 (we win 300); B casts 800 (we win 320).
  assert.deepEqual(
    p.perSegment,
    [
      { key: "a", cast: 500, ourVotes: 300 },
      { key: "b", cast: 800, ourVotes: 320 },
    ],
  );
  assert.equal(p.scenarioCast, 1300);
  assert.equal(p.totalCast, 1300);
  assert.equal(p.ourVotes, 620);
  assert.equal(p.theirVotes, 680);
  assert.equal(p.margin, -60);
  assert.ok(Math.abs(p.marginPct! - (-6000 / 1300)) < 1e-12);
  assert.equal(p.winNumber, 651);
  assert.equal(p.win, false);

  // Lift B to an even split → 700 of 1300 → win.
  const flipped = projectScenario([SEG_A, { ...SEG_B, ourSharePct: 50 }]);
  assert.equal(flipped.ourVotes, 700);
  assert.equal(flipped.margin, 100);
  assert.equal(flipped.win, true);
});

test("projection: expected-electorate override anchors the win bar", () => {
  const p = projectScenario([SEG_A, SEG_B], { expectedElectorate: 2000 });
  assert.equal(p.scenarioCast, 1300, "segment sum unchanged");
  assert.equal(p.totalCast, 2000, "override wins");
  assert.equal(p.ourVotes, 620);
  assert.equal(p.theirVotes, 1380);
  assert.equal(p.winNumber, 1001);
  assert.equal(p.win, false);
});

test("inverse share: exact break-even, verified against the projection", () => {
  const solved = solveRequiredShare([SEG_A, SEG_B], "b");
  assert.ok(solved);
  // (650 − 300) / 800 × 100 = 43.75 exactly.
  assert.equal(solved!.requiredPct, 43.75);
  assert.equal(solved!.direction, "min");
  assert.equal(solved!.attainable, true);

  // At exactly the break-even we tie (not a win); a hair above wins.
  const atBreakEven = projectScenario([SEG_A, { ...SEG_B, ourSharePct: 43.75 }]);
  assert.equal(atBreakEven.ourVotes, atBreakEven.totalCast / 2);
  assert.equal(atBreakEven.win, false);
  assert.equal(projectScenario([SEG_A, { ...SEG_B, ourSharePct: 43.76 }]).win, true);

  // Unattainable: a tiny segment cannot save a landslide loss.
  const lost = solveRequiredShare(
    [
      { key: "a", registered: 1000, turnoutPct: 50, ourSharePct: 10 },
      { key: "b", registered: 100, turnoutPct: 50, ourSharePct: 0 },
    ],
    "b",
  );
  assert.equal(lost!.requiredPct, 450);
  assert.equal(lost!.attainable, false);

  // With a fixed expected electorate the bar moves accordingly.
  const anchored = solveRequiredShare([SEG_A, SEG_B], "b", { expectedElectorate: 2000 });
  assert.equal(anchored!.requiredPct, 87.5); // (1000 − 300) / 800 × 100

  // A segment casting zero votes has no share to solve.
  assert.equal(
    solveRequiredShare([SEG_A, { ...SEG_B, turnoutPct: 0 }], "b"),
    null,
  );
});

test("inverse turnout: 'turn them out' vs 'hope they stay home', exactly", () => {
  // We win segment A (60%) — more A turnout helps. Break-even at 80%.
  const min = solveRequiredTurnout([SEG_A, SEG_B], "a");
  // (400 − 320) / (1000 × 0.1) → 0.8 (to floating-point precision)
  assert.ok(Math.abs(min!.requiredPct - 80) < 1e-9);
  assert.equal(min!.direction, "min");
  assert.equal(min!.attainable, true);
  assert.equal(projectScenario([{ ...SEG_A, turnoutPct: 80 }, SEG_B]).win, false, "tie at break-even");
  assert.equal(projectScenario([{ ...SEG_A, turnoutPct: 81 }, SEG_B]).win, true);

  // We lose the target segment (40%) — its turnout must stay LOW.
  const hostile: SegmentAssumption[] = [
    { key: "a", registered: 1000, turnoutPct: 50, ourSharePct: 40 },
    { key: "b", registered: 2000, turnoutPct: 40, ourSharePct: 53.125 },
  ];
  const max = solveRequiredTurnout(hostile, "a");
  assert.ok(Math.abs(max!.requiredPct - 25) < 1e-9); // (400 − 425) / (1000 × −0.1)
  assert.equal(max!.direction, "max");
  assert.equal(max!.attainable, true);
  assert.equal(projectScenario([{ ...hostile[0], turnoutPct: 24 }, hostile[1]]).win, true);
  assert.equal(projectScenario([{ ...hostile[0], turnoutPct: 26 }, hostile[1]]).win, false);

  // An even split means this segment's turnout can never decide it.
  assert.equal(
    solveRequiredTurnout([{ ...SEG_A, ourSharePct: 50 }, SEG_B], "a"),
    null,
  );

  // Fixed expected electorate: linear solve on our votes alone.
  const anchored = solveRequiredTurnout([SEG_A, SEG_B], "a", { expectedElectorate: 1000 });
  assert.ok(Math.abs(anchored!.requiredPct - 30) < 1e-9); // (500 − 320) / (1000 × 0.6)
  assert.equal(anchored!.direction, "min");
  const impossible = solveRequiredTurnout([SEG_A, SEG_B], "a", { expectedElectorate: 2000 });
  assert.ok(Math.abs(impossible!.requiredPct - (680 / 600) * 100) < 1e-12);
  assert.equal(impossible!.attainable, false);
});

// ---------- Standing against the live database ----------

test("standing partitions the electorate on every dimension", async () => {
  const { count: registered } = await service
    .from("voters")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignA);

  for (const dimension of ["party", "gender", "age_bracket", "zip"]) {
    const standing = await fetchStanding(manager, dimension, CYCLE_YEAR);
    assert.equal(standing.registered, registered, `${dimension}: total = campaign voters`);
    const sum = standing.segments.reduce((s, seg) => s + seg.registered, 0);
    assert.equal(sum, registered, `${dimension}: segments sum to the whole electorate`);
    assert.ok(
      standing.segments.some((s) => s.key === UNKNOWN_SEGMENT),
      `${dimension}: has the unknown residual bucket`,
    );
  }
});

test("standing turnout: per-segment counts exact against the seeded history", async () => {
  const standing = await fetchStanding(manager, "party", CYCLE_YEAR);

  // Across segments, turnout sums to exactly what was seeded.
  for (const [election, expected] of [
    ["2024_general", VOTED_2024],
    ["2022_general", VOTED_2022],
  ] as const) {
    const total = standing.segments.reduce(
      (sum, seg) => sum + (seg.turnout.find((t) => t.election === election)?.voted ?? 0),
      0,
    );
    assert.equal(total, expected, `${election} total voted`);
  }

  // Per-segment expectation computed independently from the raw rows.
  // (Door-observed attributes with key 'party' would override the file —
  // none of the earlier suites write any, but apply them if present.)
  const { data: seededRows, error } = await service
    .from("voters")
    .select("id, party, vote_history")
    .in("id", seededVoterIds.slice(0, 150)); // .in() querystring stays small enough
  assert.ifError(error);
  const { data: partyAttrs } = await service
    .from("voter_attributes")
    .select("voter_id, value")
    .eq("campaign_id", campaignA)
    .eq("key", "party");
  const observedParty = new Map((partyAttrs ?? []).map((a) => [a.voter_id, a.value]));
  const NORM: Record<string, string> = { REP: "republican", DEM: "democrat", IND: "independent", LBT: "independent" };
  const expected2022 = new Map<string, number>();
  const expectedReg = new Map<string, number>();
  for (const row of seededRows ?? []) {
    const raw = (observedParty.get(row.id) ?? row.party ?? "").toUpperCase();
    const seg = NORM[raw] ?? UNKNOWN_SEGMENT;
    const history = (row.vote_history ?? {}) as Record<string, unknown>;
    if (history["2022_general"] === true) {
      expected2022.set(seg, (expected2022.get(seg) ?? 0) + 1);
    }
    expectedReg.set(seg, (expectedReg.get(seg) ?? 0) + 1);
  }
  // The other 50 seeded voters: count them the same way.
  const { data: restRows } = await service
    .from("voters")
    .select("id, party, vote_history")
    .in("id", seededVoterIds.slice(150));
  for (const row of restRows ?? []) {
    const raw = (observedParty.get(row.id) ?? row.party ?? "").toUpperCase();
    const seg = NORM[raw] ?? UNKNOWN_SEGMENT;
    const history = (row.vote_history ?? {}) as Record<string, unknown>;
    if (history["2022_general"] === true) {
      expected2022.set(seg, (expected2022.get(seg) ?? 0) + 1);
    }
  }
  for (const [seg, expectedVoted] of expected2022) {
    const found = standing.segments.find((s) => s.key === seg);
    assert.ok(found, `segment ${seg} present`);
    const t2022 = found!.turnout.find((t) => t.election === "2022_general");
    assert.equal(t2022?.voted ?? 0, expectedVoted, `${seg} 2022 voted count`);
    // Midterm campaign (2026) → last similar is 2022; pct over segment registered.
    assert.ok(
      Math.abs(found!.lastSimilarTurnoutPct! - (expectedVoted / found!.registered) * 100) < 1e-9,
      `${seg} last-similar turnout %`,
    );
  }
});

test("standing support: seeded signals move one segment by exact deltas", async () => {
  const standing = await fetchStanding(manager, "party", CYCLE_YEAR);
  const rep = republicanSegment(standing.segments);

  assert.equal(rep.supportive - partyBefore.supportive, SEED_SUPPORTIVE, "supportive +10");
  assert.equal(rep.opposed - partyBefore.opposed, SEED_OPPOSED, "opposed +4");
  assert.equal(rep.undecided - partyBefore.undecided, SEED_UNDECIDED, "undecided +2");
  assert.equal(rep.supportSample - partyBefore.supportSample, SEED_SUPPORT.length);

  // 16+ reads → the sample is real, and the two-way share is exact.
  assert.equal(rep.insufficientSample, false);
  const supportive = partyBefore.supportive + SEED_SUPPORTIVE;
  const decided = supportive + partyBefore.opposed + SEED_OPPOSED;
  assert.ok(Math.abs(rep.ourSharePct! - (supportive / decided) * 100) < 1e-9, "two-way share");

  // Small samples never show a percentage — the graying rule.
  for (const seg of standing.segments) {
    if (seg.supportSample < SEGMENT_MIN_SAMPLE) {
      assert.equal(seg.insufficientSample, true, `${seg.key} flagged`);
      assert.equal(seg.ourSharePct, null, `${seg.key} share withheld`);
    }
  }
});

test("poll priors: manual entry appears in standing; re-entry replaces", async () => {
  const { error: insertErr } = await manager.from("poll_priors").insert({
    campaign_id: campaignA,
    dimension: "party",
    segment: "republican",
    our_share_pct: 44.5,
    source: PRIOR_SOURCE,
  });
  assert.ifError(insertErr);

  let standing = await fetchStanding(manager, "party", CYCLE_YEAR);
  let rep = republicanSegment(standing.segments);
  assert.equal(rep.pollPriorPct, 44.5);
  assert.equal(rep.pollPriorSource, PRIOR_SOURCE);

  // Same campaign/dimension/segment → upsert replaces the number.
  const { error: upsertErr } = await manager.from("poll_priors").upsert(
    {
      campaign_id: campaignA,
      dimension: "party",
      segment: "republican",
      our_share_pct: 47.25,
      source: PRIOR_SOURCE,
    },
    { onConflict: "campaign_id,dimension,segment" },
  );
  assert.ifError(upsertErr);

  standing = await fetchStanding(manager, "party", CYCLE_YEAR);
  rep = republicanSegment(standing.segments);
  assert.equal(rep.pollPriorPct, 47.25);
});

test("scenarios: save from standing, load, and re-project identically", async () => {
  const standing = await fetchStanding(manager, "party", CYCLE_YEAR);
  const assumptions: ScenarioAssumptions = {
    dimension: "party",
    segments: standing.segments.map((seg) => ({
      key: seg.key,
      label: seg.label,
      registered: seg.registered,
      turnoutPct: seg.lastSimilarTurnoutPct ?? 40,
      ourSharePct: seg.ourSharePct ?? seg.pollPriorPct ?? 50,
    })),
    expectedElectorate: null,
  };
  const original = projectScenario(assumptions.segments);

  const { data: saved, error: saveErr } = await manager
    .from("scenarios")
    .insert({
      campaign_id: campaignA,
      name: SCENARIO_NAME,
      dimension: "party",
      assumptions: assumptions as unknown as Json,
    })
    .select("id")
    .single();
  assert.ifError(saveErr);

  const { data: loaded, error: loadErr } = await manager
    .from("scenarios")
    .select("name, dimension, assumptions")
    .eq("id", saved!.id)
    .single();
  assert.ifError(loadErr);
  assert.equal(loaded!.name, SCENARIO_NAME);
  const reloaded = loaded!.assumptions as unknown as ScenarioAssumptions;
  const reprojected = projectScenario(reloaded.segments);
  assert.equal(reprojected.ourVotes, original.ourVotes, "projection survives the round-trip");
  assert.equal(reprojected.totalCast, original.totalCast);
  assert.equal(reprojected.win, original.win);
});

test("door-poll breakouts: per-segment counts reconcile per question", async () => {
  const breakouts = await fetchSurveyBreakouts(manager, "party");
  for (const b of breakouts) {
    const sum = Object.values(b.bySegment).reduce(
      (total, answers) => total + Object.values(answers).reduce((s, n) => s + n, 0),
      0,
    );
    assert.equal(sum, b.totalResponses, `${b.question}: segment counts reconcile`);
    const { count } = await service
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("question_id", b.questionId)
      .not("voter_id", "is", null);
    assert.equal(b.totalResponses, count ?? 0, `${b.question}: matches the table`);
  }
});

test("isolation: campaign B sees no scenarios, priors, or standing data", async () => {
  const [scenarios, priors] = await Promise.all([
    clientB.from("scenarios").select("id").eq("name", SCENARIO_NAME),
    clientB.from("poll_priors").select("id").eq("source", PRIOR_SOURCE),
  ]);
  assert.equal(scenarios.data!.length, 0, "no cross-campaign scenarios");
  assert.equal(priors.data!.length, 0, "no cross-campaign priors");

  const { count: bRegistered } = await service
    .from("voters")
    .select("id", { count: "exact", head: true })
    .neq("campaign_id", campaignA);
  const standingB = await fetchStanding(clientB, "party", CYCLE_YEAR);
  assert.equal(standingB.registered, bRegistered, "B's standing covers only B's voters");
});
