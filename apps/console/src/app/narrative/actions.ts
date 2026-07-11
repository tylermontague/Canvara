"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@canvara/shared";

type ActionResult = { ok: true } | { ok: false; error: string };

const LEADERSHIP_ROLES: Role[] = ["admin", "manager", "field_director"];

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
    canEdit: LEADERSHIP_ROLES.includes(profile.role as Role),
  };
}

/** Trims a list of free-text entries and drops any that end up empty. */
function cleanList(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Empty string → null so blank fields don't clutter prompts or the UI. */
function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Upserts the campaign narrative — the candidate's persona woven into every
 * generated message and canvass spark. Gated to campaign leadership; RLS
 * enforces the same rule server-side as defense-in-depth.
 */
export async function saveNarrative(input: {
  candidateName: string;
  pitch: string;
  story: string;
  values: string[];
  signatureIssues: string[];
  proofPoints: string[];
  tone: string;
}): Promise<ActionResult> {
  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId, canEdit } = resolved;

  if (!canEdit) {
    return { ok: false, error: "Only campaign leadership can edit the narrative." };
  }

  const { error } = await supabase.from("campaign_narrative").upsert(
    {
      campaign_id: campaignId,
      candidate_name: nullIfEmpty(input.candidateName),
      pitch: nullIfEmpty(input.pitch),
      story: nullIfEmpty(input.story),
      values: cleanList(input.values),
      signature_issues: cleanList(input.signatureIssues),
      proof_points: cleanList(input.proofPoints),
      tone: nullIfEmpty(input.tone),
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/narrative");
  return { ok: true };
}
