"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generatePollQuestions, generateSparks } from "@canvara/messaging";

type ActionResult = { ok: true; count: number } | { ok: false; error: string };
type SimpleResult = { ok: true } | { ok: false; error: string };

type ResolvedActor =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; actorId: string; campaignId: string }
  | { ok: false; error: string };

async function resolveActor(): Promise<ResolvedActor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("campaign_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false, error: "Could not load your campaign profile." };

  return { ok: true, supabase, actorId: user.id, campaignId: profile.campaign_id };
}

function readFocus(formData: FormData): string | undefined {
  const focus = formData.get("focus");
  if (typeof focus === "string" && focus.trim() !== "") return focus.trim();
  return undefined;
}

function readCohortId(formData: FormData): string | undefined {
  const cohortId = formData.get("cohortId");
  if (typeof cohortId === "string" && cohortId.trim() !== "") return cohortId;
  return undefined;
}

export async function generateQuestionDrafts(formData: FormData): Promise<ActionResult> {
  const focus = readFocus(formData);

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  try {
    const drafts = await generatePollQuestions(supabase, { campaignId, actorId, focus });
    revalidatePath("/workshop");
    return { ok: true, count: drafts.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to draft questions." };
  }
}

export async function generateSparkDrafts(formData: FormData): Promise<ActionResult> {
  const cohortId = readCohortId(formData);

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  try {
    const sparks = await generateSparks(supabase, { campaignId, actorId, cohortId });
    revalidatePath("/workshop");
    return { ok: true, count: sparks.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to draft sparks." };
  }
}

/**
 * Approve a question draft: the leadership-gated draft update runs FIRST —
 * it is the approval gate (RLS: only admin/manager/field_director rows
 * update). Only after it lands does the question copy into the live door
 * poll; otherwise a non-leadership member could activate a question with
 * the copy alone.
 */
export async function approveQuestionDraft(
  draftId: string,
  question: string,
  options: string[],
): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("campaign_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false, error: "Could not load your campaign profile." };

  try {
    const { data: gated, error: gateError } = await supabase
      .from("question_drafts")
      .update({
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id");
    if (gateError) return { ok: false, error: gateError.message };
    if (!gated || gated.length === 0) {
      return { ok: false, error: "Only campaign leadership can approve drafts." };
    }

    const { data: existing } = await supabase
      .from("survey_questions")
      .select("position")
      .eq("campaign_id", profile.campaign_id)
      .order("position", { ascending: false })
      .limit(1);
    const nextPosition = (existing?.[0]?.position ?? 0) + 1;

    const { error: insertError } = await supabase.from("survey_questions").insert({
      campaign_id: profile.campaign_id,
      question,
      options,
      kind: "choice",
      position: nextPosition,
    });
    if (insertError) {
      // Put the draft back so the approval can be retried cleanly.
      await supabase.from("question_drafts").update({ status: "draft" }).eq("id", draftId);
      return { ok: false, error: insertError.message };
    }

    revalidatePath("/workshop");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to approve draft." };
  }
}

export async function dismissQuestionDraft(draftId: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("question_drafts")
    .update({ status: "dismissed" })
    .eq("id", draftId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Only campaign leadership can dismiss drafts." };
  }

  revalidatePath("/workshop");
  return { ok: true };
}

export async function approveSpark(sparkId: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("sparks")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", sparkId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Only campaign leadership can approve sparks." };
  }

  revalidatePath("/workshop");
  return { ok: true };
}

export async function retireSpark(sparkId: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("sparks")
    .update({ status: "retired" })
    .eq("id", sparkId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Only campaign leadership can retire sparks." };
  }

  revalidatePath("/workshop");
  return { ok: true };
}
