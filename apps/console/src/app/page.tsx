import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@canvara/shared";
import { AppHeader } from "@/components/app-header";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Campaign Manager",
  field_director: "Field Director",
  organizer: "Organizer",
  canvasser: "Canvasser",
};

// Console navigation v1 (MODULE_MAP.md) — remaining rooms land in later milestones.
const MODULES: { label: string; href?: string; description: string }[] = [
  {
    label: "Field Office",
    href: "/voters",
    description: "Voter file, search, and walk lists.",
  },
  {
    label: "Voter Intelligence Lab",
    href: "/lab",
    description: "Ambient Pulse, issue salience, and the review queue.",
  },
  {
    label: "Scenarios",
    href: "/lab/scenarios",
    description: "Standing by cohort and the what-if electorate simulator.",
  },
  {
    label: "Narrative",
    href: "/narrative",
    description: "The candidate's story and voice, woven into every message and spark.",
  },
  {
    label: "Message Lab",
    href: "/message-lab",
    description: "Cohort and individually tailored messages, guardrail-checked.",
  },
  {
    label: "Voter Contact Workshop",
    href: "/workshop",
    description: "AI-drafted door-poll questions and canvasser conversation sparks, guardrail-checked.",
  },
  {
    label: "Admin",
    href: "/admin",
    description: "Campaign settings, pipeline health, audit trail.",
  },
];

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes both queries to the signed-in user's campaign.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, campaign_id, campaigns(name, state)")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 items-center justify-center bg-stone p-6">
          <div className="max-w-md rounded-xl border border-rule bg-white p-8 text-center">
            <h1 className="mb-2 font-serif text-xl font-bold text-navy">
              No campaign profile
            </h1>
            <p className="mb-6 text-sm text-slate">
              Your account ({user.email}) is not assigned to a campaign. Ask a
              campaign admin to create your profile.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[profile.role as Role] ?? profile.role;

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <h1 className="mb-1 font-serif text-2xl font-bold text-navy">
          {profile.campaigns?.name}
        </h1>
        <p className="mb-8 text-sm text-slate">
          {profile.campaigns?.state} · Signed in as {user.email} (
          {roleLabel}). M0 foundation — modules come online in M1+.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) =>
            m.href ? (
              <Link
                key={m.label}
                href={m.href}
                className="rounded-xl border border-rule bg-white p-5 transition-colors duration-200 ease-out hover:bg-stone"
              >
                <h2 className="mb-1 font-serif text-lg font-bold text-navy">
                  {m.label}
                </h2>
                <p className="text-sm text-slate">{m.description}</p>
              </Link>
            ) : (
              <div
                key={m.label}
                className="cursor-not-allowed rounded-xl border border-rule bg-white p-5 opacity-60"
                title="Coming in a later milestone"
              >
                <h2 className="mb-1 font-serif text-lg font-bold text-navy">
                  {m.label}
                </h2>
                <p className="text-sm text-slate">{m.description}</p>
              </div>
            ),
          )}
        </div>
      </main>
    </div>
  );
}
