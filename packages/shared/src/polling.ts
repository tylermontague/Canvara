// Polling instruments (M11): the cold-test intention protocol, stated
// issue rankings, and the pre/post persuasion delta — does a conversation
// change the cold answer? Shared by the console tables and the M11 exit
// test so the page and the assertion are the same computation.

import type { DbClient } from "@canvara/db";
import { fetchPartition } from "./scenarios";
import { SEGMENT_MIN_SAMPLE } from "./scenarios";

export const QUESTION_KINDS = ["choice", "intention", "rank"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

// The fixed cold-test protocol: comparable across time and campaigns.
export const INTENTION_OPTIONS = [
  "our_candidate",
  "opponent",
  "undecided",
  "refused",
] as const;
export type IntentionOption = (typeof INTENTION_OPTIONS)[number];

export const INTENTION_LABELS: Record<IntentionOption, string> = {
  our_candidate: "Our candidate",
  opponent: "Opponent",
  undecided: "Undecided",
  refused: "Won't say",
};

/** Rank questions ask for the top N of the curated issue list. */
export const RANK_TOP_N = 3;

// Favorability order for movement math; 'refused' pairs are excluded —
// a refusal is not a position.
const INTENTION_RANK: Record<string, number> = {
  our_candidate: 2,
  undecided: 1,
  opponent: 0,
};

// ---------- Stated issue rankings (Borda count) ----------

export interface RankStanding {
  segment: string;
  label: string;
  /** Voters in the segment who answered the rank question. */
  responses: number;
  /** issue id → Borda points (1st = RANK_TOP_N pts … Nth = 1 pt). */
  scores: Record<string, number>;
  /** Issue ids by points, descending; ties broken alphabetically. */
  order: string[];
  insufficientSample: boolean;
}

/**
 * Stated issue priorities per segment for one rank question, scored by
 * Borda count over each voter's ordered top-N answer.
 */
export async function fetchRankStanding(
  db: DbClient,
  questionId: string,
  dimensionKey: string,
): Promise<RankStanding[]> {
  const partition = await fetchPartition(db, dimensionKey);

  const responses: { voter_id: string | null; answer_items: string[] | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("survey_responses")
      .select("voter_id, answer_items")
      .eq("question_id", questionId)
      .range(from, from + 999);
    if (error) throw new Error(`rank responses: ${error.message}`);
    responses.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const bySegment = new Map<string, { responses: number; scores: Record<string, number> }>();
  for (const r of responses) {
    if (!r.voter_id || !r.answer_items || r.answer_items.length === 0) continue;
    const segment = partition.segmentOf.get(r.voter_id);
    if (!segment) continue;
    const agg = bySegment.get(segment) ?? { responses: 0, scores: {} };
    agg.responses++;
    r.answer_items.slice(0, RANK_TOP_N).forEach((issue, i) => {
      agg.scores[issue] = (agg.scores[issue] ?? 0) + (RANK_TOP_N - i);
    });
    bySegment.set(segment, agg);
  }

  return partition.segments.map(({ key, label }) => {
    const agg = bySegment.get(key) ?? { responses: 0, scores: {} };
    const order = Object.keys(agg.scores).sort(
      (a, b) => agg.scores[b] - agg.scores[a] || a.localeCompare(b),
    );
    return {
      segment: key,
      label,
      responses: agg.responses,
      scores: agg.scores,
      order,
      insufficientSample: agg.responses < SEGMENT_MIN_SAMPLE,
    };
  });
}

// ---------- Pre/post persuasion delta ----------

export interface PersuasionDelta {
  segment: string;
  label: string;
  /** Conversations with BOTH a pre and post intention answer (refusals
   *  excluded — a refusal is not a position to move from or to). */
  pairs: number;
  movedToward: number; // post more favorable than pre
  movedAway: number;
  held: number;
  /** (toward − away) / pairs × 100; null under the sample threshold. */
  netMovementPct: number | null;
  insufficientSample: boolean;
}

/**
 * Door-level persuasion per segment: of the voters cold-tested before the
 * conversation and re-asked after, how many moved toward us? This is the
 * measured number behind the what-if share sliders.
 */
export async function fetchPersuasionDelta(
  db: DbClient,
  dimensionKey: string,
): Promise<PersuasionDelta[]> {
  const partition = await fetchPartition(db, dimensionKey);

  // All intention-kind responses with a pre or post phase.
  const rows: {
    conversation_id: string;
    voter_id: string | null;
    phase: string;
    answer: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("survey_responses")
      .select("conversation_id, voter_id, phase, answer, survey_questions!inner(kind)")
      .eq("survey_questions.kind", "intention")
      .in("phase", ["pre", "post"])
      .range(from, from + 999);
    if (error) throw new Error(`delta responses: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // Pair pre/post per conversation.
  const byConversation = new Map<
    string,
    { voterId: string | null; pre?: string | null; post?: string | null }
  >();
  for (const r of rows) {
    const entry = byConversation.get(r.conversation_id) ?? { voterId: r.voter_id };
    if (r.phase === "pre") entry.pre = r.answer;
    else entry.post = r.answer;
    if (r.voter_id) entry.voterId = r.voter_id;
    byConversation.set(r.conversation_id, entry);
  }

  const bySegment = new Map<string, { pairs: number; toward: number; away: number; held: number }>();
  for (const entry of byConversation.values()) {
    if (!entry.voterId || entry.pre == null || entry.post == null) continue;
    const preRank = INTENTION_RANK[entry.pre];
    const postRank = INTENTION_RANK[entry.post];
    if (preRank === undefined || postRank === undefined) continue; // refusals out
    const segment = partition.segmentOf.get(entry.voterId);
    if (!segment) continue;
    const agg = bySegment.get(segment) ?? { pairs: 0, toward: 0, away: 0, held: 0 };
    agg.pairs++;
    if (postRank > preRank) agg.toward++;
    else if (postRank < preRank) agg.away++;
    else agg.held++;
    bySegment.set(segment, agg);
  }

  return partition.segments.map(({ key, label }) => {
    const agg = bySegment.get(key) ?? { pairs: 0, toward: 0, away: 0, held: 0 };
    const insufficientSample = agg.pairs < SEGMENT_MIN_SAMPLE;
    return {
      segment: key,
      label,
      pairs: agg.pairs,
      movedToward: agg.toward,
      movedAway: agg.away,
      held: agg.held,
      netMovementPct:
        insufficientSample || agg.pairs === 0
          ? null
          : ((agg.toward - agg.away) / agg.pairs) * 100,
      insufficientSample,
    };
  });
}
