// Per-spark effectiveness (M12): join each spark's usages to those
// conversations' pre/post intention pairs. Topics that move cold answers
// earn their place on the briefing card; ones that don't get retired.

import type { DbClient } from "@canvara/db";
import { SEGMENT_MIN_SAMPLE } from "./scenarios";

const INTENTION_RANK: Record<string, number> = {
  our_candidate: 2,
  undecided: 1,
  opponent: 0,
};

export interface SparkEffect {
  sparkId: string;
  title: string;
  status: string;
  /** Conversations where the canvasser tapped this spark as used. */
  usages: number;
  /** Of those, conversations with a full pre/post intention pair. */
  pairs: number;
  movedToward: number;
  movedAway: number;
  held: number;
  /** (toward − away) / pairs × 100; null under the sample threshold. */
  netMovementPct: number | null;
  insufficientSample: boolean;
}

export async function fetchSparkEffects(db: DbClient): Promise<SparkEffect[]> {
  const [sparksRes, usagesRes] = await Promise.all([
    db.from("sparks").select("id, title, status").order("created_at"),
    db.from("spark_usages").select("spark_id, conversation_id"),
  ]);
  if (sparksRes.error) throw new Error(`sparks: ${sparksRes.error.message}`);
  if (usagesRes.error) throw new Error(`spark usages: ${usagesRes.error.message}`);
  const usages = usagesRes.data ?? [];

  // Pre/post intention pairs for every conversation a spark was used in.
  const conversationIds = [...new Set(usages.map((u) => u.conversation_id))];
  const pairByConversation = new Map<string, { pre?: string | null; post?: string | null }>();
  const CHUNK = 150; // keep .in() querystrings under URL limits
  for (let i = 0; i < conversationIds.length; i += CHUNK) {
    const chunk = conversationIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("survey_responses")
      .select("conversation_id, phase, answer, survey_questions!inner(kind)")
      .eq("survey_questions.kind", "intention")
      .in("phase", ["pre", "post"])
      .in("conversation_id", chunk);
    if (error) throw new Error(`spark pairs: ${error.message}`);
    for (const r of data ?? []) {
      const entry = pairByConversation.get(r.conversation_id) ?? {};
      if (r.phase === "pre") entry.pre = r.answer;
      else entry.post = r.answer;
      pairByConversation.set(r.conversation_id, entry);
    }
  }

  return (sparksRes.data ?? []).map((spark) => {
    const mine = usages.filter((u) => u.spark_id === spark.id);
    let pairs = 0;
    let toward = 0;
    let away = 0;
    let held = 0;
    for (const usage of mine) {
      const pair = pairByConversation.get(usage.conversation_id);
      if (!pair || pair.pre == null || pair.post == null) continue;
      const preRank = INTENTION_RANK[pair.pre];
      const postRank = INTENTION_RANK[pair.post];
      if (preRank === undefined || postRank === undefined) continue; // refusals out
      pairs++;
      if (postRank > preRank) toward++;
      else if (postRank < preRank) away++;
      else held++;
    }
    const insufficientSample = pairs < SEGMENT_MIN_SAMPLE;
    return {
      sparkId: spark.id,
      title: spark.title,
      status: spark.status,
      usages: mine.length,
      pairs,
      movedToward: toward,
      movedAway: away,
      held,
      netMovementPct:
        insufficientSample || pairs === 0 ? null : ((toward - away) / pairs) * 100,
      insufficientSample,
    };
  });
}
