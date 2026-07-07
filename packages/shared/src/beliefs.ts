// Belief engine v1 (IE-5): Beta(α, β) per voter per issue, with time decay.
//
// The belief models "this issue is a live lever for this voter". Evidence:
//  - issue mentioned in a conversation → α increment (spontaneous mentions
//    are stronger evidence than prompted ones)
//  - a full conversation where a previously-believed issue does NOT come up
//    → small β increment (absence is weak evidence)
// Decay: both parameters relax toward the uninformative prior Beta(1,1)
// with a half-life, so stale beliefs fade instead of fossilizing.
//
// Pure math lives here (unit-testable, exact); the db application function
// below is shared by the worker and the M6 exit test.

import type { DbClient } from "@canvara/db";
import { ISSUE_IDS } from "./issues";

export const BELIEF_HALF_LIFE_DAYS = 60;
export const SPONTANEOUS_WEIGHT = 2;
export const PROMPTED_WEIGHT = 1;
export const ABSENCE_WEIGHT = 0.5;

/** Relax a Beta parameter toward the prior (1) by half-life. */
export function decayParam(value: number, elapsedDays: number): number {
  if (elapsedDays <= 0) return value;
  return 1 + (value - 1) * Math.pow(2, -elapsedDays / BELIEF_HALF_LIFE_DAYS);
}

export function beliefMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/** Effective observation count behind a belief (0 for the bare prior). */
export function beliefStrength(alpha: number, beta: number): number {
  return alpha + beta - 2;
}

export interface BeliefUpdateInput {
  campaignId: string;
  voterId: string;
  /** Issues mentioned in the conversation (signals.top_issues). */
  topIssues: string[];
  /** Per-issue provenance map (signals.provenance). */
  provenance: Record<string, string>;
  observedAt: string; // ISO
  /** Only full conversations count absence as evidence. */
  fullConversation: boolean;
}

export interface BeliefUpdateResult {
  updated: number;
  skippedUnknown: string[];
}

/**
 * Apply one conversation's evidence to a voter's belief states.
 * Idempotence note: callers must apply each conversation at most once
 * (the worker does this at extraction time, which is upsert-guarded).
 */
export async function updateBeliefsForSignal(
  db: DbClient,
  input: BeliefUpdateInput,
): Promise<BeliefUpdateResult> {
  const observedMs = new Date(input.observedAt).getTime();
  const mentioned = input.topIssues.filter((i) => ISSUE_IDS.has(i));
  const skippedUnknown = input.topIssues.filter((i) => !ISSUE_IDS.has(i));

  const { data: existing, error: readErr } = await db
    .from("belief_states")
    .select("issue_id, alpha, beta, last_observed_at")
    .eq("voter_id", input.voterId);
  if (readErr) throw new Error(`read beliefs: ${readErr.message}`);
  const byIssue = new Map((existing ?? []).map((b) => [b.issue_id, b]));

  const rows: {
    campaign_id: string;
    voter_id: string;
    issue_id: string;
    alpha: number;
    beta: number;
    source: string;
    last_observed_at: string;
    updated_at: string;
  }[] = [];
  const now = new Date().toISOString();

  // Mentioned issues: decay, then add evidence.
  for (const issue of mentioned) {
    const prior = byIssue.get(issue);
    const elapsedDays = prior?.last_observed_at
      ? (observedMs - new Date(prior.last_observed_at).getTime()) / 86_400_000
      : 0;
    const alpha0 = prior ? decayParam(prior.alpha, elapsedDays) : 1;
    const beta0 = prior ? decayParam(prior.beta, elapsedDays) : 1;
    const weight =
      input.provenance[issue] === "spontaneous" ? SPONTANEOUS_WEIGHT : PROMPTED_WEIGHT;
    rows.push({
      campaign_id: input.campaignId,
      voter_id: input.voterId,
      issue_id: issue,
      alpha: alpha0 + weight,
      beta: beta0,
      source: "first_party",
      last_observed_at: input.observedAt,
      updated_at: now,
    });
  }

  // Absent issues (full conversations only): decay + weak β evidence.
  if (input.fullConversation) {
    for (const prior of existing ?? []) {
      if (mentioned.includes(prior.issue_id)) continue;
      const elapsedDays = prior.last_observed_at
        ? (observedMs - new Date(prior.last_observed_at).getTime()) / 86_400_000
        : 0;
      rows.push({
        campaign_id: input.campaignId,
        voter_id: input.voterId,
        issue_id: prior.issue_id,
        alpha: decayParam(prior.alpha, elapsedDays),
        beta: decayParam(prior.beta, elapsedDays) + ABSENCE_WEIGHT,
        source: "first_party",
        last_observed_at: input.observedAt,
        updated_at: now,
      });
    }
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await db
      .from("belief_states")
      .upsert(rows, { onConflict: "voter_id,issue_id" });
    if (upsertErr) throw new Error(`upsert beliefs: ${upsertErr.message}`);
  }

  return { updated: rows.length, skippedUnknown };
}

export interface VoterBelief {
  issue: string;
  mean: number;
  strength: number;
}

/** Tier-2 briefing read (FA-3): a voter's strongest believed issues. */
export async function fetchVoterBeliefs(
  db: DbClient,
  voterIds: string[],
): Promise<Map<string, VoterBelief[]>> {
  if (voterIds.length === 0) return new Map();
  const { data, error } = await db
    .from("belief_states")
    .select("voter_id, issue_id, alpha, beta")
    .in("voter_id", voterIds);
  if (error) throw new Error(`fetch beliefs: ${error.message}`);

  const map = new Map<string, VoterBelief[]>();
  for (const row of data ?? []) {
    const list = map.get(row.voter_id) ?? [];
    list.push({
      issue: row.issue_id,
      mean: beliefMean(row.alpha, row.beta),
      strength: beliefStrength(row.alpha, row.beta),
    });
    map.set(row.voter_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.mean - a.mean || b.strength - a.strength);
  }
  return map;
}
