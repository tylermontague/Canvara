// The conversation pipeline (IE-1..IE-4):
//   uploaded → transcribing → transcribed → extracting → extracted | review
// Claims are optimistic status transitions (idempotent under concurrent
// workers); every stage is resumable after a crash, and failures mark the
// conversation failed with an audit_log entry rather than wedging the queue.

import type { DbClient, Json, Tables } from "@canvara/db";
import type { TranscriptUtterance } from "@canvara/shared";
import { transcribe } from "./deepgram";
import { extractSignal, signalToRow } from "./extract";
import { generateDebriefSummary } from "./debrief";
import { parseWkbPoint } from "./wkb";

const CORRELATION_RADIUS_M = 75;

export interface PipelineStats {
  transcribed: number;
  extracted: number;
  review: number;
  failed: number;
}

type Conversation = Tables<"conversations">;

async function audit(
  db: DbClient,
  campaignId: string,
  action: string,
  conversationId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.from("audit_log").insert({
    campaign_id: campaignId,
    action,
    entity: "conversation",
    entity_id: conversationId,
    detail: detail as Json,
  });
}

/** Optimistically claim one conversation in `from` status, moving it to `to`. */
async function claim(
  db: DbClient,
  from: string,
  to: string,
): Promise<Conversation | null> {
  const { data: candidates, error } = await db
    .from("conversations")
    .select("id")
    .eq("status", from)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`claim select: ${error.message}`);
  if (!candidates || candidates.length === 0) return null;

  const { data: claimed, error: claimErr } = await db
    .from("conversations")
    .update({ status: to })
    .eq("id", candidates[0].id)
    .eq("status", from) // lost race → 0 rows, caller retries next tick
    .select()
    .maybeSingle();
  if (claimErr) throw new Error(`claim update: ${claimErr.message}`);
  return claimed;
}

async function fail(db: DbClient, convo: Conversation, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db.from("conversations").update({ status: "failed" }).eq("id", convo.id);
  await audit(db, convo.campaign_id, "pipeline_failed", convo.id, { error: message });
  console.error(`[pipeline] ${convo.id} failed: ${message}`);
}

/** Stage 1: download audio, transcribe with diarization. */
async function transcribeStage(
  db: DbClient,
  deepgramKey: string,
  convo: Conversation,
): Promise<boolean> {
  if (!convo.audio_path) {
    throw new Error("conversation has no audio_path");
  }
  const { data: blob, error } = await db.storage.from("conversations").download(convo.audio_path);
  if (error || !blob) throw new Error(`audio download: ${error?.message ?? "no data"}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentType = blob.type && blob.type !== "" ? blob.type : "audio/mp4";

  const { transcript, werEstimate } = await transcribe(deepgramKey, bytes, contentType);
  if (transcript.length === 0) {
    throw new Error("empty transcript — audio may be silent or unreadable");
  }

  const { error: updateErr } = await db
    .from("conversations")
    .update({
      transcript: transcript as unknown as Json,
      wer_estimate: werEstimate,
      status: "transcribed",
    })
    .eq("id", convo.id);
  if (updateErr) throw new Error(`transcript save: ${updateErr.message}`);
  return true;
}

/** Stage 2 (IE-3): GPS → voter correlation. Canvasser override always wins. */
async function correlateStage(db: DbClient, convo: Conversation): Promise<void> {
  if (convo.voter_id_manual || convo.voter_id) return; // manual/known wins
  const point = parseWkbPoint(convo.gps);
  if (!point) return;

  const { data, error } = await db.rpc("correlate_voter", {
    p_campaign_id: convo.campaign_id,
    p_lat: point.lat,
    p_lng: point.lng,
    p_max_meters: CORRELATION_RADIUS_M,
  });
  if (error) throw new Error(`correlate_voter: ${error.message}`);
  const match = data?.[0];
  if (!match) return;

  const { error: updateErr } = await db
    .from("conversations")
    .update({ voter_id: match.voter_id })
    .eq("id", convo.id)
    .eq("voter_id_manual", false); // re-check: never clobber a manual override
  if (updateErr) throw new Error(`correlation save: ${updateErr.message}`);
}

/** Stage 3 (IE-4): extraction with escalation; writes the signal row. */
async function extractStage(db: DbClient, convo: Conversation): Promise<"extracted" | "review"> {
  const transcript = convo.transcript as unknown as TranscriptUtterance[];
  if (!transcript || transcript.length === 0) {
    throw new Error("no transcript to extract from");
  }

  const outcome = await extractSignal(transcript);

  // Debrief note for the canvasser (FA-5). Best-effort — a missing summary
  // must never block the signal itself.
  let debriefSummary = "";
  try {
    debriefSummary = await generateDebriefSummary(transcript, outcome.signal);
  } catch (err) {
    console.warn(`[pipeline] debrief summary failed for ${convo.id}:`, err);
  }

  const { error: signalErr } = await db.from("signals").upsert(
    {
      campaign_id: convo.campaign_id,
      conversation_id: convo.id,
      ...signalToRow(outcome.signal),
      debrief_summary: debriefSummary || null,
      model_used: outcome.modelUsed,
      prompt_version: outcome.promptVersion,
    },
    { onConflict: "conversation_id" },
  );
  if (signalErr) throw new Error(`signal upsert: ${signalErr.message}`);

  let finalStatus: "extracted" | "review" = "extracted";
  if (outcome.needsReview) {
    finalStatus = "review";
    // Idempotent: only one open low-confidence entry per conversation.
    const { data: existing } = await db
      .from("review_queue")
      .select("id")
      .eq("conversation_id", convo.id)
      .eq("status", "open")
      .maybeSingle();
    if (!existing) {
      const { error: reviewErr } = await db.from("review_queue").insert({
        campaign_id: convo.campaign_id,
        conversation_id: convo.id,
        reason: "low_confidence",
      });
      if (reviewErr) throw new Error(`review queue: ${reviewErr.message}`);
    }
  }

  const { error: statusErr } = await db
    .from("conversations")
    .update({ status: finalStatus })
    .eq("id", convo.id);
  if (statusErr) throw new Error(`status save: ${statusErr.message}`);

  await audit(db, convo.campaign_id, "signal_extracted", convo.id, {
    model_used: outcome.modelUsed,
    prompt_version: outcome.promptVersion,
    escalated: outcome.escalated,
    confidence: outcome.signal.confidence,
    routed_to_review: outcome.needsReview,
  });
  return finalStatus;
}

/** Drain all available work. Safe to call repeatedly / concurrently. */
export async function processAvailable(
  db: DbClient,
  deepgramKey: string,
): Promise<PipelineStats> {
  const stats: PipelineStats = { transcribed: 0, extracted: 0, review: 0, failed: 0 };

  // Transcription queue: uploaded → transcribing → transcribed
  for (;;) {
    const convo = await claim(db, "uploaded", "transcribing");
    if (!convo) break;
    try {
      await transcribeStage(db, deepgramKey, convo);
      stats.transcribed++;
    } catch (err) {
      await fail(db, convo, err);
      stats.failed++;
    }
  }

  // Extraction queue: transcribed → extracting → extracted | review
  for (;;) {
    const convo = await claim(db, "transcribed", "extracting");
    if (!convo) break;
    try {
      await correlateStage(db, convo);
      const status = await extractStage(db, convo);
      if (status === "review") stats.review++;
      else stats.extracted++;
    } catch (err) {
      await fail(db, convo, err);
      stats.failed++;
    }
  }

  return stats;
}
