// Debrief confirm/correct (FA-5) and review adjudication (IE-8).
// Shared by the field app, the console, and the M4 exit test so every
// surface writes corrections, audit entries, and statuses identically.
// Corrections are training data: every change records field, from, to,
// who, and when.

import type { DbClient, Json } from "@canvara/db";

/** Signal fields a canvasser or reviewer may correct. */
export const CORRECTABLE_FIELDS = [
  "support_level",
  "persuadability",
  "emotional_valence",
  "top_issues",
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface DebriefCorrection {
  field: CorrectableField;
  from: Json;
  to: Json;
}

interface CorrectionLogEntry extends DebriefCorrection {
  corrected_by: string;
  corrected_at: string;
  source: "debrief" | "review";
}

async function applyCorrections(
  db: DbClient,
  signalId: string,
  corrections: DebriefCorrection[],
  actorId: string,
  source: "debrief" | "review",
): Promise<CorrectionLogEntry[]> {
  const { data: current, error: readErr } = await db
    .from("signals")
    .select("corrections")
    .eq("id", signalId)
    .single();
  if (readErr) throw new Error(`read signal: ${readErr.message}`);

  const now = new Date().toISOString();
  const entries: CorrectionLogEntry[] = corrections.map((c) => ({
    ...c,
    corrected_by: actorId,
    corrected_at: now,
    source,
  }));

  const fieldUpdates: Record<string, Json> = {};
  for (const c of corrections) fieldUpdates[c.field] = c.to;

  const existing = (current?.corrections as Json[] | null) ?? [];
  const { error: updateErr } = await db
    .from("signals")
    .update({
      ...fieldUpdates,
      corrections: [...existing, ...(entries as unknown as Json[])],
    })
    .eq("id", signalId);
  if (updateErr) throw new Error(`apply corrections: ${updateErr.message}`);
  return entries;
}

export interface DebriefInput {
  signalId: string;
  conversationId: string;
  campaignId: string;
  /** The canvasser confirming/correcting (profiles.id). */
  actorId: string;
  /** Empty array = pure confirmation. */
  corrections: DebriefCorrection[];
}

/**
 * Canvasser debrief: apply corrections (if any), mark the signal
 * canvasser-confirmed, complete the conversation, write the audit entry.
 */
export async function submitDebrief(db: DbClient, input: DebriefInput): Promise<void> {
  const entries =
    input.corrections.length > 0
      ? await applyCorrections(db, input.signalId, input.corrections, input.actorId, "debrief")
      : [];

  const { error: confirmErr } = await db
    .from("signals")
    .update({ canvasser_confirmed: true })
    .eq("id", input.signalId);
  if (confirmErr) throw new Error(`confirm signal: ${confirmErr.message}`);

  const { error: statusErr } = await db
    .from("conversations")
    .update({ status: "complete" })
    .eq("id", input.conversationId);
  if (statusErr) throw new Error(`complete conversation: ${statusErr.message}`);

  const { error: auditErr } = await db.from("audit_log").insert({
    campaign_id: input.campaignId,
    actor_id: input.actorId,
    action: entries.length > 0 ? "debrief_corrected" : "debrief_confirmed",
    entity: "signal",
    entity_id: input.signalId,
    detail: { corrections: entries } as unknown as Json,
  });
  if (auditErr) throw new Error(`audit: ${auditErr.message}`);
}

export interface ReviewResolutionInput {
  reviewId: string;
  signalId: string;
  conversationId: string;
  campaignId: string;
  /** The reviewer (profiles.id). */
  actorId: string;
  /** "accept" keeps the extraction as-is; corrections imply "correct". */
  corrections: DebriefCorrection[];
}

/**
 * Console review adjudication (IE-8): apply corrections, resolve the queue
 * entry, move the conversation back to extracted (debrief still pending),
 * write the audit entry. Human decision is final.
 */
export async function resolveReview(db: DbClient, input: ReviewResolutionInput): Promise<void> {
  const entries =
    input.corrections.length > 0
      ? await applyCorrections(db, input.signalId, input.corrections, input.actorId, "review")
      : [];

  const resolution = {
    action: entries.length > 0 ? "corrected" : "accepted",
    corrections: entries,
  };

  const { error: resolveErr } = await db
    .from("review_queue")
    .update({
      status: "resolved",
      resolved_by: input.actorId,
      resolution: resolution as unknown as Json,
    })
    .eq("id", input.reviewId)
    .eq("status", "open");
  if (resolveErr) throw new Error(`resolve review: ${resolveErr.message}`);

  const { error: statusErr } = await db
    .from("conversations")
    .update({ status: "extracted" })
    .eq("id", input.conversationId)
    .eq("status", "review");
  if (statusErr) throw new Error(`conversation status: ${statusErr.message}`);

  const { error: auditErr } = await db.from("audit_log").insert({
    campaign_id: input.campaignId,
    actor_id: input.actorId,
    action: "review_resolved",
    entity: "review_queue",
    entity_id: input.reviewId,
    detail: resolution as unknown as Json,
  });
  if (auditErr) throw new Error(`audit: ${auditErr.message}`);
}
