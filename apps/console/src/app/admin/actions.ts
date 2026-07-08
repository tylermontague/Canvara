"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  QUESTION_KINDS,
  INTENTION_OPTIONS,
  ISSUE_IDS,
  type QuestionKind,
} from "@canvara/shared";

type ActionResult = { ok: true } | { ok: false; error: string };

const RANK_MIN_ISSUES = 3;
const RANK_MAX_ISSUES = 8;

type ResolvedActor =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      actorId: string;
      campaignId: string;
      canEdit: boolean;
    }
  | { ok: false; error: string };

async function resolveActor(): Promise<ResolvedActor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("campaign_id, role")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false, error: "Could not load your campaign profile." };

  return {
    ok: true,
    supabase,
    actorId: user.id,
    campaignId: profile.campaign_id,
    canEdit: profile.role === "admin" || profile.role === "manager",
  };
}

/**
 * Creates a survey question of any kind ('choice', 'intention', 'rank').
 * The fixed cold-test protocol and curated-issue rank options are enforced
 * server-side so a tampered client can't smuggle in ad-hoc options.
 */
export async function createSurveyQuestion(input: {
  kind: QuestionKind;
  question: string;
  /** 'choice': free-text options. 'rank': curated issue ids, checked order. Ignored for 'intention'. */
  options?: string[];
}): Promise<ActionResult> {
  const text = input.question.trim();
  if (!text) return { ok: false, error: "Question text is required." };

  if (!(QUESTION_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: "Unrecognized question kind." };
  }

  let options: string[];
  if (input.kind === "choice") {
    options = (input.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    if (options.length < 2) {
      return { ok: false, error: "Provide at least two comma-separated options." };
    }
  } else if (input.kind === "intention") {
    // Fixed protocol — comparable across time and campaigns. Ignore whatever
    // the client sent for options.
    options = [...INTENTION_OPTIONS];
  } else {
    const issueIds = (input.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    if (issueIds.length < RANK_MIN_ISSUES || issueIds.length > RANK_MAX_ISSUES) {
      return {
        ok: false,
        error: `Select ${RANK_MIN_ISSUES}–${RANK_MAX_ISSUES} issues (aim for about 5).`,
      };
    }
    const unknown = issueIds.find((id) => !ISSUE_IDS.has(id));
    if (unknown) return { ok: false, error: `Unrecognized issue: ${unknown}.` };
    options = issueIds;
  }

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, campaignId, canEdit } = resolved;
  if (!canEdit) return { ok: false, error: "You don't have permission to add questions." };

  const { data: existing } = await supabase
    .from("survey_questions")
    .select("position")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1;

  const { error } = await supabase.from("survey_questions").insert({
    campaign_id: campaignId,
    question: text,
    options,
    kind: input.kind,
    position: nextPosition,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
