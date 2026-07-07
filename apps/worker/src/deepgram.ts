// Deepgram ASR + diarization (IE-2, ADR-2). Nova model family, REST API.

import type { TranscriptUtterance } from "@canvara/shared";

const DEEPGRAM_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&smart_format=true&punctuate=true&utterances=true";

interface DeepgramUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker: number;
  confidence: number;
}

export interface TranscriptionResult {
  transcript: TranscriptUtterance[];
  /** Rough quality proxy: 1 − mean utterance confidence. Real WER via spot checks. */
  werEstimate: number | null;
}

export async function transcribe(
  apiKey: string,
  audio: Uint8Array,
  contentType: string,
): Promise<TranscriptionResult> {
  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": contentType,
    },
    body: audio as unknown as RequestInit["body"],
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    results?: { utterances?: DeepgramUtterance[] };
  };
  const utterances = json.results?.utterances ?? [];

  const transcript: TranscriptUtterance[] = utterances.map((u) => ({
    speaker: `S${u.speaker}`,
    text: u.transcript,
    ts: u.start,
  }));

  const confidences = utterances.map((u) => u.confidence).filter((c) => Number.isFinite(c));
  const werEstimate =
    confidences.length > 0
      ? 1 - confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

  return { transcript, werEstimate };
}
