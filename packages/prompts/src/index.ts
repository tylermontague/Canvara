// @canvara/prompts — versioned extraction prompts (Fable-authored, Haiku-executed).
// Every signal records the prompt version used (signals.prompt_version).
// M0: registry shape only. Extraction prompts land with M3.

export interface PromptVersion {
  id: string; // e.g. "extract-signal"
  version: string; // e.g. "v1"
  model: string; // e.g. "claude-haiku-4-5"
  text: string;
}

export const prompts: Record<string, PromptVersion> = {};
