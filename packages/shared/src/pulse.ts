// Ambient Pulse tier 1 (CC-1/CC-2): typed reads over the pulse_* views.
// Shared by the console dashboard and the M5 exit test so "what the page
// shows" and "what the test asserts" are the same computation.

import type { DbClient } from "@canvara/db";
import { SUPPORT_LEVELS } from "./signal";

// Insufficient-sample thresholds (Ambient Polling). Percentages and shares
// are statistically meaningless below these — the UI grays them out rather
// than inviting bad decisions. Tune per campaign in a later milestone.
export const PULSE_MIN_SAMPLE = 30; // for the support distribution
export const ISSUE_MIN_MENTIONS = 5; // per-issue salience entries

export interface SupportDistribution {
  total: number;
  counts: Record<string, number>; // support_level -> n
  /** True when total < PULSE_MIN_SAMPLE — gray the percentages. */
  insufficientSample: boolean;
}

export interface IssueSalience {
  issue: string;
  mentions: number;
  spontaneous: number;
  negative: number;
  positive: number;
  neutralMixed: number;
  /** True when mentions < ISSUE_MIN_MENTIONS — gray the row. */
  insufficientSample: boolean;
}

export interface TrendDay {
  day: string; // YYYY-MM-DD
  total: number;
  counts: Record<string, number>;
  /** (support − oppose) / total, −1..1; null under the day threshold. */
  netSupport: number | null;
}

const SUPPORTIVE = new Set(["strong_support", "lean_support"]);
const OPPOSED = new Set(["strong_oppose", "lean_oppose"]);
const TREND_DAY_MIN = 5;

export async function fetchSupportDistribution(db: DbClient): Promise<SupportDistribution> {
  const { data, error } = await db.from("pulse_support_distribution").select("support_level, n");
  if (error) throw new Error(`support distribution: ${error.message}`);
  const counts: Record<string, number> = Object.fromEntries(SUPPORT_LEVELS.map((l) => [l, 0]));
  let total = 0;
  for (const row of data ?? []) {
    counts[row.support_level] = row.n;
    total += row.n;
  }
  return { total, counts, insufficientSample: total < PULSE_MIN_SAMPLE };
}

/**
 * Issues ordered by salience: spontaneous mentions first (the ambient
 * signal), total mentions as tiebreak.
 */
export async function fetchIssueSalience(db: DbClient): Promise<IssueSalience[]> {
  const { data, error } = await db
    .from("pulse_issue_salience")
    .select("issue, mentions, spontaneous, negative, positive, neutral_mixed");
  if (error) throw new Error(`issue salience: ${error.message}`);
  return (data ?? [])
    .map((r) => ({
      issue: r.issue,
      mentions: r.mentions,
      spontaneous: r.spontaneous,
      negative: r.negative,
      positive: r.positive,
      neutralMixed: r.neutral_mixed,
      insufficientSample: r.mentions < ISSUE_MIN_MENTIONS,
    }))
    .sort((a, b) => b.spontaneous - a.spontaneous || b.mentions - a.mentions);
}

export async function fetchDailyTrend(db: DbClient): Promise<TrendDay[]> {
  const { data, error } = await db
    .from("pulse_daily_trend")
    .select("day, support_level, n")
    .order("day", { ascending: true });
  if (error) throw new Error(`daily trend: ${error.message}`);

  const byDay = new Map<string, TrendDay>();
  for (const row of data ?? []) {
    const entry =
      byDay.get(row.day) ?? { day: row.day, total: 0, counts: {}, netSupport: null };
    entry.counts[row.support_level] = (entry.counts[row.support_level] ?? 0) + row.n;
    entry.total += row.n;
    byDay.set(row.day, entry);
  }
  for (const entry of byDay.values()) {
    if (entry.total >= TREND_DAY_MIN) {
      let support = 0;
      let oppose = 0;
      for (const [level, n] of Object.entries(entry.counts)) {
        if (SUPPORTIVE.has(level)) support += n;
        if (OPPOSED.has(level)) oppose += n;
      }
      entry.netSupport = (support - oppose) / entry.total;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
