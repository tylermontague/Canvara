// Signal extraction (IE-4, ADR-8): Haiku 4.5 in bulk, Sonnet 4.6 when the
// first pass comes back under the confidence threshold. Structured outputs
// guarantee schema-valid SignalObjects.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  SignalObjectSchema,
  transcriptToText,
  type SignalObject,
  type TranscriptUtterance,
} from "@canvara/shared";
import { extractSignalPrompt, buildExtractionInput } from "@canvara/prompts";

// Model strategy per BUILD_PLAN §4 (ADR-8).
const BULK_MODEL = "claude-haiku-4-5";
const ESCALATION_MODEL = "claude-sonnet-4-6";
export const CONFIDENCE_THRESHOLD = 0.6;

// Lazy: constructed on first use so module import never precedes env loading.
let _client: Anthropic | null = null;
function client(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

export interface ExtractionOutcome {
  signal: SignalObject;
  modelUsed: string;
  promptVersion: string;
  escalated: boolean;
  /** Still under threshold after escalation → route to review queue. */
  needsReview: boolean;
}

async function runExtraction(
  model: string,
  transcriptText: string,
  options: { thinking?: boolean } = {},
): Promise<SignalObject | null> {
  const response = await client().messages.parse({
    model,
    max_tokens: 8000,
    system: extractSignalPrompt.text,
    ...(options.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    messages: [{ role: "user", content: buildExtractionInput(transcriptText) }],
    output_config: { format: zodOutputFormat(SignalObjectSchema) },
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

export async function extractSignal(
  transcript: TranscriptUtterance[],
): Promise<ExtractionOutcome> {
  const transcriptText = transcriptToText(transcript);

  const bulk = await runExtraction(BULK_MODEL, transcriptText);
  if (bulk && bulk.confidence >= CONFIDENCE_THRESHOLD) {
    return {
      signal: bulk,
      modelUsed: BULK_MODEL,
      promptVersion: extractSignalPrompt.version,
      escalated: false,
      needsReview: false,
    };
  }

  // Escalation path: low confidence or failed parse → Sonnet with thinking.
  const escalated = await runExtraction(ESCALATION_MODEL, transcriptText, { thinking: true });
  const signal = escalated ?? bulk;
  if (!signal) {
    throw new Error("extraction failed on both models (refusal or unparseable output)");
  }
  return {
    signal,
    modelUsed: escalated ? ESCALATION_MODEL : BULK_MODEL,
    promptVersion: extractSignalPrompt.version,
    escalated: true,
    needsReview: signal.confidence < CONFIDENCE_THRESHOLD,
  };
}

/** SignalObject → signals-table column values (pair-arrays → jsonb maps). */
export function signalToRow(signal: SignalObject) {
  return {
    support_level: signal.support_level,
    top_issues: signal.top_issues,
    issue_sentiment: Object.fromEntries(
      signal.issue_sentiment.map((s) => [s.issue, s.sentiment]),
    ),
    emotional_valence: signal.emotional_valence,
    persuadability: signal.persuadability,
    information_gaps: signal.information_gaps,
    message_resonance: signal.message_resonance,
    follow_up_signals: signal.follow_up_signals,
    provenance: Object.fromEntries(signal.provenance.map((p) => [p.issue, p.source])),
    confidence_score: signal.confidence,
  };
}
