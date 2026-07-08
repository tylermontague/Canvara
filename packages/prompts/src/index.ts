// @canvara/prompts — versioned extraction prompts (Fable-authored, Haiku-executed).
// Every signal records the prompt version used (signals.prompt_version).

export interface PromptVersion {
  id: string; // e.g. "extract-signal"
  version: string; // e.g. "extract-signal.v1"
  model: string; // default executor, e.g. "claude-haiku-4-5"
  text: string;
}

export {
  extractSignalPrompt,
  buildExtractionInput,
  EXTRACT_SIGNAL_VERSION,
} from "./extract-signal";
export { debriefSummaryPrompt, DEBRIEF_SUMMARY_VERSION } from "./debrief-summary";
export {
  messageCohortPrompt,
  messageIndividualPrompt,
  guardrailPrompt,
  MESSAGE_COHORT_VERSION,
  MESSAGE_INDIVIDUAL_VERSION,
  GUARDRAIL_VERSION,
} from "./messages";
