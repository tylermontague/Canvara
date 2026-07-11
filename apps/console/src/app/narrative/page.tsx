import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import type { Role } from "@canvara/shared";
import { NarrativeForm } from "./narrative-form";

const LEADERSHIP_ROLES: Role[] = ["admin", "manager", "field_director"];

export default async function NarrativePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, campaign_id")
    .eq("id", user.id)
    .single();

  const canEdit = profile ? LEADERSHIP_ROLES.includes(profile.role as Role) : false;

  const narrative = profile?.campaign_id
    ? (
        await supabase
          .from("campaign_narrative")
          .select(
            "candidate_name, pitch, story, values, signature_issues, proof_points, tone, updated_at",
          )
          .eq("campaign_id", profile.campaign_id)
          .maybeSingle()
      ).data
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Campaign narrative</h1>
          <p className="text-sm text-slate">
            The candidate&apos;s story and voice — woven into every message and canvass spark.
          </p>
        </div>

        <section className="rounded-xl border border-rule bg-white p-5">
          <NarrativeForm
            initial={{
              candidateName: narrative?.candidate_name ?? "",
              pitch: narrative?.pitch ?? "",
              story: narrative?.story ?? "",
              values: narrative?.values ?? [],
              signatureIssues: narrative?.signature_issues ?? [],
              proofPoints: narrative?.proof_points ?? [],
              tone: narrative?.tone ?? "",
              updatedAt: narrative?.updated_at ?? null,
            }}
            canEdit={canEdit}
          />
        </section>
      </main>
    </div>
  );
}
