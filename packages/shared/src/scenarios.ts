// "How are we doing" standing + what-if electorate simulator (M9).
//
// Standing partitions the electorate along ONE dimension at a time (a
// pollster break from COHORT_DIMENSIONS, or a regional column), with an
// explicit "unknown" residual bucket, so segments always sum to the full
// electorate — no double-counting when the simulator projects a margin.
//
// The scenario math is pure and exact: registered × turnout × our-share
// per segment → projected votes. The win bar defaults to the scenario's
// own total votes cast, with an optional user-entered expected-electorate
// override. Two-candidate assumption v1: every cast vote we don't win,
// the opponent does; undecideds are held out of the baseline share and
// enter only through the sliders.

import type { DbClient } from "@canvara/db";
import {
  COHORT_DIMENSIONS,
  fetchObservedAttributes,
  voterDimensionValue,
  type VoterDemographics,
} from "./cohorts";
import { classifyElection, type ElectionCycle } from "./district";

// Below this many voters with a support read, a segment's our-share %
// is statistically meaningless — the UI grays it and the simulator
// baseline falls back to even. (PULSE_MIN_SAMPLE=30 guards the whole
// electorate; per-segment slices get a lower but still-honest bar.)
export const SEGMENT_MIN_SAMPLE = 15;

export const UNKNOWN_SEGMENT = "unknown";

/** Regional rollups: raw column values become the segments. */
export const REGIONAL_DIMENSIONS = [
  { key: "precinct", label: "Precinct" },
  { key: "zip", label: "ZIP code" },
] as const;

export const STANDING_DIMENSIONS = [
  ...COHORT_DIMENSIONS.map((d) => ({ key: d.key, label: d.label })),
  ...REGIONAL_DIMENSIONS,
];

const SUPPORTIVE = new Set(["strong_support", "lean_support"]);
const OPPOSED = new Set(["strong_oppose", "lean_oppose"]);

export interface SegmentTurnout {
  election: string;
  voted: number;
  pct: number; // of the segment's registered voters
  cycle: ElectionCycle;
}

export interface SegmentStanding {
  key: string; // canonical option value, raw precinct/zip, or "unknown"
  label: string;
  registered: number;
  /** General elections only, newest first. */
  turnout: SegmentTurnout[];
  /** Most recent general matching the campaign's cycle (midterm/presidential). */
  lastSimilarTurnoutPct: number | null;
  /** Members with at least one support signal (latest signal per voter). */
  supportSample: number;
  supportive: number; // strong_support + lean_support
  opposed: number; // strong_oppose + lean_oppose
  undecided: number; // everything else with a read (undecided/unknown)
  /** Two-way share: supportive / (supportive + opposed) × 100. Null when
   *  the sample is insufficient or nobody has picked a side. */
  ourSharePct: number | null;
  /** True when supportSample < SEGMENT_MIN_SAMPLE — gray the share. */
  insufficientSample: boolean;
  /** Manually entered external poll prior (poll_priors table). */
  pollPriorPct: number | null;
  pollPriorSource: string | null;
}

export interface DimensionStanding {
  dimension: { key: string; label: string };
  registered: number; // whole electorate — segments sum to this
  segments: SegmentStanding[];
}

interface PartitionVoter extends VoterDemographics {
  precinct: string | null;
  zip: string | null;
  vote_history: unknown;
}

interface Partition {
  dimension: { key: string; label: string };
  voters: PartitionVoter[];
  /** voter id → segment key ("unknown" when the attribute is missing). */
  segmentOf: Map<string, string>;
  /** segment key → label, in display order (unknown last). */
  segments: { key: string; label: string }[];
}

async function fetchPartition(db: DbClient, dimensionKey: string): Promise<Partition> {
  const cohortDim = COHORT_DIMENSIONS.find((d) => d.key === dimensionKey);
  const regionalDim = REGIONAL_DIMENSIONS.find((d) => d.key === dimensionKey);
  if (!cohortDim && !regionalDim) {
    throw new Error(`unknown standing dimension: ${dimensionKey}`);
  }

  const voters: PartitionVoter[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("voters")
      .select(
        "id, gender, birth_year, race, education, income_bracket, party, religion, precinct, zip, vote_history",
      )
      .range(from, from + 999);
    if (error) throw new Error(`standing voters: ${error.message}`);
    voters.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const segmentOf = new Map<string, string>();
  let segments: { key: string; label: string }[];

  if (cohortDim) {
    const observed = await fetchObservedAttributes(db);
    for (const v of voters) {
      const value = voterDimensionValue(v, dimensionKey, observed.get(v.id));
      segmentOf.set(v.id, value ?? UNKNOWN_SEGMENT);
    }
    segments = cohortDim.options.map((o) => ({ key: o.value, label: o.label }));
  } else {
    const seen = new Set<string>();
    for (const v of voters) {
      const raw = dimensionKey === "precinct" ? v.precinct : v.zip;
      const value = raw && raw.trim() !== "" ? raw.trim() : UNKNOWN_SEGMENT;
      segmentOf.set(v.id, value);
      if (value !== UNKNOWN_SEGMENT) seen.add(value);
    }
    segments = [...seen].sort().map((key) => ({ key, label: key }));
  }
  segments.push({ key: UNKNOWN_SEGMENT, label: "Unknown" });

  return {
    dimension: { key: dimensionKey, label: (cohortDim ?? regionalDim)!.label },
    voters,
    segmentOf,
    segments,
  };
}

/** Latest support level per voter, from signals joined through conversations. */
async function fetchLatestSupport(db: DbClient): Promise<Map<string, string | null>> {
  const latest = new Map<string, { support: string | null; recordedAt: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("signals")
      .select("support_level, conversations!inner(voter_id, recorded_at)")
      .range(from, from + 999);
    if (error) throw new Error(`standing signals: ${error.message}`);
    for (const s of data ?? []) {
      const voterId = s.conversations.voter_id;
      if (!voterId) continue;
      const prev = latest.get(voterId);
      if (!prev || s.conversations.recorded_at > prev.recordedAt) {
        latest.set(voterId, {
          support: s.support_level,
          recordedAt: s.conversations.recorded_at,
        });
      }
    }
    if (!data || data.length < 1000) break;
  }
  return new Map([...latest].map(([id, v]) => [id, v.support]));
}

/**
 * Current standing along one dimension: registered, historical turnout,
 * and our support share per segment, plus any manual poll prior.
 *
 * @param cycleYear the campaign's election year — picks which past general
 * counts as "last similar" (midterm compares to midterm, etc.).
 */
export async function fetchStanding(
  db: DbClient,
  dimensionKey: string,
  cycleYear = new Date().getFullYear(),
): Promise<DimensionStanding> {
  const partition = await fetchPartition(db, dimensionKey);
  const [latestSupport, priorsRes] = await Promise.all([
    fetchLatestSupport(db),
    db
      .from("poll_priors")
      .select("segment, our_share_pct, source")
      .eq("dimension", dimensionKey),
  ]);
  if (priorsRes.error) throw new Error(`poll priors: ${priorsRes.error.message}`);
  const priors = new Map(
    (priorsRes.data ?? []).map((p) => [p.segment, p] as const),
  );

  const currentCycle: ElectionCycle =
    cycleYear % 4 === 0 ? "presidential" : cycleYear % 4 === 2 ? "midterm" : "other";

  const bySegment = new Map<string, PartitionVoter[]>();
  for (const v of partition.voters) {
    const key = partition.segmentOf.get(v.id)!;
    const list = bySegment.get(key) ?? [];
    list.push(v);
    bySegment.set(key, list);
  }

  const segments: SegmentStanding[] = partition.segments.map(({ key, label }) => {
    const members = bySegment.get(key) ?? [];

    // Turnout per general election, within the segment.
    const votedBy = new Map<string, number>();
    for (const m of members) {
      const history = (m.vote_history ?? {}) as Record<string, unknown>;
      for (const [election, voted] of Object.entries(history)) {
        if (voted === true || voted === "true") {
          votedBy.set(election, (votedBy.get(election) ?? 0) + 1);
        }
      }
    }
    const turnout: SegmentTurnout[] = [...votedBy.entries()]
      .map(([election, voted]) => {
        const info = classifyElection(election);
        if (!info || info.kind !== "general") return null;
        return {
          election,
          voted,
          pct: members.length > 0 ? (voted / members.length) * 100 : 0,
          cycle: info.cycle,
        };
      })
      .filter((t): t is SegmentTurnout => t !== null)
      .sort((a, b) => b.election.localeCompare(a.election));
    const lastSimilar = turnout.find((t) => t.cycle === currentCycle) ?? null;

    // Support from each member's latest signal.
    let supportive = 0;
    let opposed = 0;
    let undecided = 0;
    for (const m of members) {
      const support = latestSupport.get(m.id);
      if (support === undefined || support === null) continue;
      if (SUPPORTIVE.has(support)) supportive++;
      else if (OPPOSED.has(support)) opposed++;
      else undecided++;
    }
    const supportSample = supportive + opposed + undecided;
    const insufficientSample = supportSample < SEGMENT_MIN_SAMPLE;
    const decided = supportive + opposed;
    const ourSharePct =
      insufficientSample || decided === 0 ? null : (supportive / decided) * 100;

    const prior = priors.get(key);
    return {
      key,
      label,
      registered: members.length,
      turnout,
      lastSimilarTurnoutPct: lastSimilar?.pct ?? null,
      supportSample,
      supportive,
      opposed,
      undecided,
      ourSharePct,
      insufficientSample,
      pollPriorPct: prior?.our_share_pct ?? null,
      pollPriorSource: prior?.source ?? null,
    };
  });

  return {
    dimension: partition.dimension,
    registered: partition.voters.length,
    segments,
  };
}

// ---------- Door-poll breakouts ("results of any polling we're doing") ----------

export interface SurveyBreakout {
  questionId: string;
  question: string;
  options: string[];
  /** segment key → answer → count (only answers actually given appear). */
  bySegment: Record<string, Record<string, number>>;
  totalResponses: number;
}

/** Door-poll answer distributions per segment along one dimension. */
export async function fetchSurveyBreakouts(
  db: DbClient,
  dimensionKey: string,
): Promise<SurveyBreakout[]> {
  const partition = await fetchPartition(db, dimensionKey);

  const { data: questions, error: qErr } = await db
    .from("survey_questions")
    .select("id, question, options, position")
    .order("position");
  if (qErr) throw new Error(`survey questions: ${qErr.message}`);

  const responses: { question_id: string; voter_id: string | null; answer: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("survey_responses")
      .select("question_id, voter_id, answer")
      .range(from, from + 999);
    if (error) throw new Error(`survey responses: ${error.message}`);
    responses.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  return (questions ?? []).map((q) => {
    const bySegment: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const r of responses) {
      if (r.question_id !== q.id || !r.voter_id) continue;
      const segment = partition.segmentOf.get(r.voter_id);
      if (!segment) continue;
      const answers = (bySegment[segment] ??= {});
      answers[r.answer] = (answers[r.answer] ?? 0) + 1;
      total++;
    }
    return {
      questionId: q.id,
      question: q.question,
      options: q.options,
      bySegment,
      totalResponses: total,
    };
  });
}

// ---------- The what-if model (pure math, no I/O) ----------

export interface SegmentAssumption {
  key: string;
  label?: string;
  registered: number;
  /** Assumed turnout, 0–100 (% of the segment's registered voters). */
  turnoutPct: number;
  /** Assumed share of the segment's cast votes that we win, 0–100. */
  ourSharePct: number;
}

export interface ScenarioOptions {
  /**
   * Optional user-entered expected total votes cast. When set, it anchors
   * the win bar and the opponent's pool; our votes still come from the
   * segment assumptions. When absent, total cast = the scenario's own sum.
   */
  expectedElectorate?: number | null;
}

export interface SegmentProjection {
  key: string;
  cast: number;
  ourVotes: number;
}

export interface ScenarioProjection {
  /** Sum of per-segment cast votes (before any override). */
  scenarioCast: number;
  /** The electorate the race is judged against (override or scenarioCast). */
  totalCast: number;
  ourVotes: number;
  theirVotes: number; // totalCast − ourVotes (two-candidate v1)
  /** Votes needed to win: floor(totalCast/2) + 1. */
  winNumber: number;
  margin: number; // ourVotes − theirVotes
  marginPct: number | null; // of totalCast
  win: boolean; // ourVotes > totalCast / 2
  perSegment: SegmentProjection[];
}

/**
 * Project a scenario. Exact real-number math — the UI rounds for display.
 * Segments MUST partition the electorate (fetchStanding guarantees this:
 * one dimension at a time plus the "unknown" bucket).
 */
export function projectScenario(
  segments: SegmentAssumption[],
  options: ScenarioOptions = {},
): ScenarioProjection {
  const perSegment: SegmentProjection[] = segments.map((s) => {
    const cast = (s.registered * s.turnoutPct) / 100;
    return { key: s.key, cast, ourVotes: (cast * s.ourSharePct) / 100 };
  });
  const scenarioCast = perSegment.reduce((sum, s) => sum + s.cast, 0);
  const ourVotes = perSegment.reduce((sum, s) => sum + s.ourVotes, 0);
  const totalCast = options.expectedElectorate ?? scenarioCast;
  const theirVotes = totalCast - ourVotes;
  return {
    scenarioCast,
    totalCast,
    ourVotes,
    theirVotes,
    winNumber: Math.floor(totalCast / 2) + 1,
    margin: ourVotes - theirVotes,
    marginPct: totalCast > 0 ? ((ourVotes - theirVotes) / totalCast) * 100 : null,
    win: totalCast > 0 && ourVotes > totalCast / 2,
    perSegment,
  };
}

export interface SolveResult {
  /** The break-even value — you need strictly more (min) or less (max). */
  requiredPct: number;
  /** 'min': at least this much wins. 'max': stay at or below this. */
  direction: "min" | "max";
  /** True when some value in [0, 100] wins the race. */
  attainable: boolean;
}

/**
 * Hold every other segment at its given assumptions and solve the target
 * segment's OUR-SHARE % for the 50% break-even. "To win, you need >N% of
 * 65+ voters at their assumed turnout." Null when the segment casts no
 * votes (its share can't matter).
 */
export function solveRequiredShare(
  segments: SegmentAssumption[],
  targetKey: string,
  options: ScenarioOptions = {},
): SolveResult | null {
  const target = segments.find((s) => s.key === targetKey);
  if (!target) throw new Error(`solveRequiredShare: no segment '${targetKey}'`);
  const targetCast = (target.registered * target.turnoutPct) / 100;
  if (targetCast === 0) return null;

  const others = segments.filter((s) => s.key !== targetKey);
  const otherOurVotes = others.reduce(
    (sum, s) => sum + (s.registered * s.turnoutPct * s.ourSharePct) / 10000,
    0,
  );
  const otherCast = others.reduce((sum, s) => sum + (s.registered * s.turnoutPct) / 100, 0);
  const totalCast = options.expectedElectorate ?? otherCast + targetCast;

  // otherOurVotes + targetCast × s/100 = totalCast / 2
  const requiredPct = ((totalCast / 2 - otherOurVotes) / targetCast) * 100;
  return { requiredPct, direction: "min", attainable: requiredPct <= 100 };
}

/**
 * Hold every other segment (and the target's our-share) fixed and solve
 * the target segment's TURNOUT % for break-even. With scenario-derived
 * totals, raising a segment's turnout also raises the win bar, so the
 * direction depends on whether we win (>50% share, more turnout helps)
 * or lose (<50%, more turnout hurts) that segment. Null when turnout of
 * this segment cannot change the outcome (share exactly 50%, or zero
 * share under an override).
 */
export function solveRequiredTurnout(
  segments: SegmentAssumption[],
  targetKey: string,
  options: ScenarioOptions = {},
): SolveResult | null {
  const target = segments.find((s) => s.key === targetKey);
  if (!target) throw new Error(`solveRequiredTurnout: no segment '${targetKey}'`);
  if (target.registered === 0) return null;
  const share = target.ourSharePct / 100;

  const others = segments.filter((s) => s.key !== targetKey);
  const otherOurVotes = others.reduce(
    (sum, s) => sum + (s.registered * s.turnoutPct * s.ourSharePct) / 10000,
    0,
  );
  const otherCast = others.reduce((sum, s) => sum + (s.registered * s.turnoutPct) / 100, 0);

  if (options.expectedElectorate != null) {
    // Fixed win bar: otherOurVotes + reg × t/100 × share = E / 2.
    if (share === 0) return null;
    const requiredPct =
      ((options.expectedElectorate / 2 - otherOurVotes) / (target.registered * share)) * 100;
    return { requiredPct, direction: "min", attainable: requiredPct <= 100 };
  }

  // Scenario-derived bar:
  //   otherOurVotes + reg·T·share = (otherCast + reg·T) / 2,  T = t/100
  //   T · reg · (share − 1/2) = otherCast/2 − otherOurVotes
  if (share === 0.5) return null;
  const requiredT =
    (otherCast / 2 - otherOurVotes) / (target.registered * (share - 0.5));
  const requiredPct = requiredT * 100;
  if (share > 0.5) {
    // We win this segment — turnout above the break-even wins the race.
    return { requiredPct, direction: "min", attainable: requiredPct <= 100 };
  }
  // We lose this segment — turnout must stay at or below the break-even.
  return { requiredPct, direction: "max", attainable: requiredPct >= 0 };
}

// ---------- Saved scenarios ----------

/** Shape stored in scenarios.assumptions (jsonb). */
export interface ScenarioAssumptions {
  dimension: string;
  segments: SegmentAssumption[];
  expectedElectorate?: number | null;
}
