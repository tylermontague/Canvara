// Retention enforcement (CX-2): per-campaign retention_days governs how
// long raw conversation content (audio + transcript) is kept. Past the
// cutoff, the audio object is deleted from storage and the transcript is
// cleared; derived signals and aggregates remain. Every purge is audited.

import type { DbClient, Json } from "@canvara/db";

export interface RetentionStats {
  examined: number;
  purged: number;
  errors: string[];
}

export async function runRetentionSweep(db: DbClient): Promise<RetentionStats> {
  const stats: RetentionStats = { examined: 0, purged: 0, errors: [] };

  const { data: campaigns, error: campErr } = await db
    .from("campaigns")
    .select("id, retention_days");
  if (campErr) throw new Error(`retention campaigns: ${campErr.message}`);

  for (const campaign of campaigns ?? []) {
    const cutoff = new Date(Date.now() - campaign.retention_days * 86_400_000).toISOString();
    // Only rows that still hold raw content.
    const { data: expired, error: expErr } = await db
      .from("conversations")
      .select("id, audio_path")
      .eq("campaign_id", campaign.id)
      .lt("recorded_at", cutoff)
      .or("audio_path.not.is.null,transcript.not.is.null")
      .limit(500);
    if (expErr) {
      stats.errors.push(`${campaign.id}: ${expErr.message}`);
      continue;
    }

    for (const convo of expired ?? []) {
      stats.examined++;
      try {
        if (convo.audio_path) {
          const { error: rmErr } = await db.storage
            .from("conversations")
            .remove([convo.audio_path]);
          if (rmErr && !/not.*found/i.test(rmErr.message)) {
            throw new Error(`storage remove: ${rmErr.message}`);
          }
        }
        const { error: updErr } = await db
          .from("conversations")
          .update({ audio_path: null, transcript: null })
          .eq("id", convo.id);
        if (updErr) throw new Error(`clear content: ${updErr.message}`);

        const { error: auditErr } = await db.from("audit_log").insert({
          campaign_id: campaign.id,
          action: "retention_purged",
          entity: "conversation",
          entity_id: convo.id,
          detail: {
            retention_days: campaign.retention_days,
            had_audio: convo.audio_path !== null,
          } as unknown as Json,
        });
        if (auditErr) throw new Error(`audit: ${auditErr.message}`);
        stats.purged++;
      } catch (err) {
        stats.errors.push(
          `${convo.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return stats;
}
