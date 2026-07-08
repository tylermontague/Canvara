"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ScenarioAssumptions } from "@canvara/shared";
import type { Json } from "@canvara/db";

type ActionResult = { ok: true } | { ok: false; error: string };

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

/** Upserts a manually entered external poll prior for one segment (form action). */
export async function savePollPrior(formData: FormData): Promise<ActionResult> {
  const dimension = formData.get("dimension");
  const segment = formData.get("segment");
  const ourSharePctRaw = formData.get("ourSharePct");
  const source = formData.get("source");

  if (typeof dimension !== "string" || dimension === "") {
    return { ok: false, error: "Missing dimension." };
  }
  if (typeof segment !== "string" || segment === "") {
    return { ok: false, error: "Missing segment." };
  }
  if (typeof source !== "string" || source.trim() === "") {
    return { ok: false, error: "Source is required." };
  }
  const ourSharePct = Number(ourSharePctRaw);
  if (!Number.isFinite(ourSharePct) || ourSharePct < 0 || ourSharePct > 100) {
    return { ok: false, error: "Share must be between 0 and 100." };
  }

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  const { error } = await supabase.from("poll_priors").upsert(
    {
      campaign_id: campaignId,
      dimension,
      segment,
      our_share_pct: ourSharePct,
      source: source.trim(),
      created_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id,dimension,segment" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/lab/scenarios");
  return { ok: true };
}

/** Form-action wrapper for savePollPrior (React form actions must return void). */
export async function savePollPriorForm(formData: FormData): Promise<void> {
  await savePollPrior(formData);
}

/** Saves a what-if scenario (current slider assumptions) for later recall. */
export async function saveScenario(input: {
  name: string;
  dimension: string;
  notes?: string | null;
  assumptions: ScenarioAssumptions;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase, actorId, campaignId } = resolved;

  const { error } = await supabase.from("scenarios").insert({
    campaign_id: campaignId,
    name: input.name.trim(),
    dimension: input.dimension,
    notes: input.notes && input.notes.trim() !== "" ? input.notes.trim() : null,
    assumptions: input.assumptions as unknown as Json,
    created_by: actorId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/lab/scenarios");
  return { ok: true };
}

/** Deletes a saved scenario. RLS scopes this to the actor's own campaign. */
export async function deleteScenario(id: string): Promise<ActionResult> {
  const resolved = await resolveActor();
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { supabase } = resolved;

  const { error } = await supabase.from("scenarios").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/lab/scenarios");
  return { ok: true };
}
