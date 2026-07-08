"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateCohortMessages, generateIndividualMessages } from "@canvara/messaging";
import type { MessageGoal } from "@canvara/messaging";

type ActionResult = { ok: true; count: number } | { ok: false; error: string };

function readGoal(formData: FormData): MessageGoal | null {
  const goal = formData.get("goal");
  if (goal === "persuade" || goal === "turnout" || goal === "introduce") return goal;
  return null;
}

function readIssue(formData: FormData): string | undefined {
  const issue = formData.get("issue");
  if (typeof issue === "string" && issue.trim() !== "") return issue;
  return undefined;
}

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

export async function generateForCohort(formData: FormData): Promise<ActionResult> {
  const cohortId = formData.get("cohortId");
  if (typeof cohortId !== "string" || cohortId === "") {
    return { ok: false, error: "Select a cohort." };
  }
  const goal = readGoal(formData);
  if (!goal) return { ok: false, error: "Select a goal." };
  const issue = readIssue(formData);

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  try {
    const messages = await generateCohortMessages(supabase, {
      campaignId,
      actorId,
      goal,
      issue,
      cohortId,
    });
    revalidatePath("/message-lab");
    return { ok: true, count: messages.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to generate messages." };
  }
}

export async function generateForVoter(formData: FormData): Promise<ActionResult> {
  const voterId = formData.get("voterId");
  if (typeof voterId !== "string" || voterId === "") {
    return { ok: false, error: "Select a voter." };
  }
  const goal = readGoal(formData);
  if (!goal) return { ok: false, error: "Select a goal." };
  const issue = readIssue(formData);

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  try {
    const messages = await generateIndividualMessages(supabase, {
      campaignId,
      actorId,
      goal,
      issue,
      voterId,
    });
    revalidatePath("/message-lab");
    return { ok: true, count: messages.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to generate messages." };
  }
}

export async function setMessageStatus(
  messageId: string,
  status: "approved" | "rejected",
): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const { data, error } = await supabase
      .from("messages")
      .update({
        status,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Only campaign leadership can approve messages." };
    }

    await supabase.from("audit_log").insert({
      campaign_id: profile.campaign_id,
      actor_id: user.id,
      action: `message_${status}`,
      entity: "message",
      entity_id: messageId,
    });

    revalidatePath("/message-lab");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update message." };
  }
}
