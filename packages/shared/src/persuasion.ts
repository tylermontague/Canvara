// Per-voter persuasion profile (M6.5) — the artifact the Message Lab will
// consume, and the reason canvassing data is retained.
//
// PRECEDENCE (the product's overriding insight): evidence from personal
// conversations ALWAYS trumps cohort inference. A voter whose cohort
// predicts anti-immigration sentiment but who told a canvasser about their
// mission in Chile must never receive cohort-default messaging on that
// issue. Consumers must honor `precedence` ordering: individual evidence
// (beliefs, sentiment, resonance, context, observed attributes) first;
// cohort priors only fill gaps where no individual evidence exists.

import type { DbClient } from "@canvara/db";
import { beliefMean, beliefStrength, type VoterBelief } from "./beliefs";

export interface ResonanceEvent {
  message: string;
  response: string;
  at: string; // conversation recorded_at
}

export interface PersuasionProfile {
  voterId: string;
  /** Door-observed / extracted attributes (these override the file). */
  observedAttributes: { key: string; value: string; source: string }[];
  /** Durable connection facts from conversations, newest first. */
  personalContext: string[];
  /** Belief-engine issue levers, strongest first. */
  beliefs: VoterBelief[];
  /** Latest per-issue sentiment from conversations. */
  issueSentiment: Record<string, string>;
  /** Every message tried on this voter and how it landed, newest first. */
  resonanceHistory: ResonanceEvent[];
  /** Contract for consumers: individual evidence beats cohort priors. */
  precedence: "individual_over_cohort";
}

export async function fetchPersuasionProfile(
  db: DbClient,
  voterId: string,
): Promise<PersuasionProfile> {
  const [attributesRes, signalsRes, beliefsRes] = await Promise.all([
    db
      .from("voter_attributes")
      .select("key, value, source")
      .eq("voter_id", voterId)
      .order("created_at", { ascending: false }),
    db
      .from("signals")
      .select(
        "personal_context, issue_sentiment, message_resonance, conversations!inner(voter_id, recorded_at)",
      )
      .eq("conversations.voter_id", voterId),
    db
      .from("belief_states")
      .select("issue_id, alpha, beta")
      .eq("voter_id", voterId),
  ]);
  if (attributesRes.error) throw new Error(`attributes: ${attributesRes.error.message}`);
  if (signalsRes.error) throw new Error(`signals: ${signalsRes.error.message}`);
  if (beliefsRes.error) throw new Error(`beliefs: ${beliefsRes.error.message}`);

  const signals = (signalsRes.data ?? []).sort((a, b) =>
    b.conversations.recorded_at.localeCompare(a.conversations.recorded_at),
  );

  const personalContext: string[] = [];
  const seenContext = new Set<string>();
  const resonanceHistory: ResonanceEvent[] = [];
  const issueSentiment: Record<string, string> = {};

  for (const signal of signals) {
    for (const fact of signal.personal_context ?? []) {
      const key = fact.trim().toLowerCase();
      if (!seenContext.has(key)) {
        seenContext.add(key);
        personalContext.push(fact);
      }
    }
    const resonance = (signal.message_resonance as { message: string; response: string }[]) ?? [];
    for (const r of resonance) {
      resonanceHistory.push({ ...r, at: signal.conversations.recorded_at });
    }
    // signals are newest-first; keep the first (latest) sentiment per issue.
    const sentiment = (signal.issue_sentiment as Record<string, string> | null) ?? {};
    for (const [issue, value] of Object.entries(sentiment)) {
      if (!(issue in issueSentiment)) issueSentiment[issue] = value;
    }
  }

  const beliefs: VoterBelief[] = (beliefsRes.data ?? [])
    .map((b) => ({
      issue: b.issue_id,
      mean: beliefMean(b.alpha, b.beta),
      strength: beliefStrength(b.alpha, b.beta),
    }))
    .sort((a, b) => b.mean - a.mean || b.strength - a.strength);

  return {
    voterId,
    observedAttributes: attributesRes.data ?? [],
    personalContext,
    beliefs,
    issueSentiment,
    resonanceHistory,
    precedence: "individual_over_cohort",
  };
}
