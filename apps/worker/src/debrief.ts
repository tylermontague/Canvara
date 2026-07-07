// Debrief summary generation (FA-5, ADR-8): Haiku, latency-cheap, produced
// at extraction time and stored on the signal so the field app can show it
// seconds after the door.

import Anthropic from "@anthropic-ai/sdk";
import { transcriptToText, type SignalObject, type TranscriptUtterance } from "@canvara/shared";
import { debriefSummaryPrompt } from "@canvara/prompts";

let _client: Anthropic | null = null;
function client(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

export async function generateDebriefSummary(
  transcript: TranscriptUtterance[],
  signal: SignalObject,
): Promise<string> {
  const response = await client().messages.create({
    model: debriefSummaryPrompt.model,
    max_tokens: 300,
    system: debriefSummaryPrompt.text,
    messages: [
      {
        role: "user",
        content:
          `<transcript>\n${transcriptToText(transcript)}\n</transcript>\n\n` +
          `Extracted read: support=${signal.support_level}, top issues=${signal.top_issues.join(", ") || "none"}, ` +
          `follow-ups=${signal.follow_up_signals.join("; ") || "none"}.\n\nWrite the debrief note.`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || response.content.length === 0) {
    return "";
  }
  const block = response.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}
