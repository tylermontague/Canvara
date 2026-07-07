// Debrief summary prompt v1 (FA-5). Haiku-executed at extraction time; the
// output is shown to the canvasser seconds after the door for a tappable
// confirm/correct. Changes MUST bump VERSION.

import type { PromptVersion } from "./index";

export const DEBRIEF_SUMMARY_VERSION = "debrief-summary.v1";

const TEXT = `You write a debrief note for the canvasser who just finished a doorstep conversation. They will read it on their phone, standing on the sidewalk, and tap "confirm" if it matches what happened.

Write 2-3 short sentences, addressed to the canvasser ("You spoke with..."), in plain everyday language a volunteer understands. Cover: who they talked to and the voter's overall stance, the one or two things the voter cared about most, and any follow-up that was promised or requested. Mention only what actually happened in the transcript. No headers, no bullets, no jargon, no percentages — just the note.`;

export const debriefSummaryPrompt: PromptVersion = {
  id: "debrief-summary",
  version: DEBRIEF_SUMMARY_VERSION,
  model: "claude-haiku-4-5",
  text: TEXT,
};
