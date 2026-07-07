// SignalObject — the 11-field Ambient Polling taxonomy (the "Learn"
// contract, IE-4). This is the structured output every extraction produces
// and what the signals table stores. Kept as a zod schema so the worker,
// prompts, and tests all validate against the same definition.
//
// Structured-outputs note: records/maps are expressed as arrays of pairs
// (JSON-schema `additionalProperties` beyond `false` isn't supported by
// constrained decoding); the worker converts to jsonb objects on write.

import { z } from "zod";

export const SUPPORT_LEVELS = [
  "strong_support",
  "lean_support",
  "undecided",
  "lean_oppose",
  "strong_oppose",
  "unknown",
] as const;

export const EMOTIONAL_VALENCES = [
  "enthusiastic",
  "positive",
  "neutral",
  "frustrated",
  "hostile",
] as const;

export const PERSUADABILITY_LEVELS = [
  "locked_in",
  "leaning",
  "persuadable",
  "disengaged",
] as const;

export const SENTIMENTS = ["positive", "negative", "mixed", "neutral"] as const;
export const PROVENANCE_SOURCES = ["spontaneous", "prompted"] as const;
export const RESONANCE_RESPONSES = ["positive", "negative", "neutral", "unclear"] as const;

export const SignalObjectSchema = z.object({
  /** 1 — Brief grounding analysis; written first so every later field is evidence-based. */
  reasoning: z.string(),
  /** 2 — Candidate support level. */
  support_level: z.enum(SUPPORT_LEVELS),
  /** 3 — Issues raised, ordered by salience (unprompted first). Slugs, snake_case. */
  top_issues: z.array(z.string()),
  /** 4 — Sentiment per raised issue. */
  issue_sentiment: z.array(
    z.object({
      issue: z.string(),
      sentiment: z.enum(SENTIMENTS),
    }),
  ),
  /** 5 — Overall emotional tone of the voter. */
  emotional_valence: z.enum(EMOTIONAL_VALENCES),
  /** 6 — How movable the voter appears. */
  persuadability: z.enum(PERSUADABILITY_LEVELS),
  /** 7 — Things the voter wanted to know / misinformation encountered. */
  information_gaps: z.array(z.string()),
  /** 8 — Messages the canvasser tried and how each landed. */
  message_resonance: z.array(
    z.object({
      message: z.string(),
      response: z.enum(RESONANCE_RESPONSES),
    }),
  ),
  /** 9 — Follow-up signals: requests, volunteering interest, do-not-contact, etc. */
  follow_up_signals: z.array(z.string()),
  /** 10 — Per-issue provenance: raised spontaneously by the voter, or prompted. */
  provenance: z.array(
    z.object({
      issue: z.string(),
      source: z.enum(PROVENANCE_SOURCES),
    }),
  ),
  /** 11 — Extraction confidence 0..1 (drives the Sonnet escalation at <0.6). */
  confidence: z.number().min(0).max(1),
  /**
   * 12 (M6.5) — Durable personal-connection facts the voter volunteered,
   * for tailored messaging later ("served a mission in Chile", "grandkids
   * at Fremont Elementary", "spouse follows politics"). Survives retention
   * purges of the raw transcript, so it must stand alone.
   */
  personal_context: z.array(z.string()),
});

export type SignalObject = z.infer<typeof SignalObjectSchema>;

/** Diarized transcript shape stored in conversations.transcript. */
export interface TranscriptUtterance {
  speaker: string; // "S0", "S1", ...
  text: string;
  ts: number; // seconds from start
}

export function transcriptToText(transcript: TranscriptUtterance[]): string {
  return transcript.map((u) => `${u.speaker}: ${u.text}`).join("\n");
}
