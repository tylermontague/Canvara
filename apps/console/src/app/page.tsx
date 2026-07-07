import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@canvara/shared";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Campaign Manager",
  field_director: "Field Director",
  organizer: "Organizer",
  canvasser: "Canvasser",
};

// Console navigation v1 (MODULE_MAP.md) — remaining rooms land in later milestones.
const MODULES: { label: string; href?: string }[] = [
  { label: "Field Office", href: "/voters" },
  { label: "Voter Intelligence Lab" },
  { label: "Message Lab" },
  { label: "Voter Contact Workshop" },
  { label: "Admin" },
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
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-xl font-semibold text-zinc-50">
            No campaign profile
          </h1>
          <p className="mb-6 text-sm text-zinc-400">
            Your account ({user.email}) is not assigned to a campaign. Ask a
            campaign admin to create your profile.
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }

  const roleLabel = ROLE_LABELS[profile.role as Role] ?? profile.role;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-baseline gap-6">
          <span className="text-lg font-semibold">Canvara</span>
          <nav className="hidden gap-4 text-sm text-zinc-400 md:flex">
            {MODULES.map((m) =>
              m.href ? (
                <Link key={m.label} href={m.href} className="text-zinc-200 hover:text-white">
                  {m.label}
                </Link>
              ) : (
                <span
                  key={m.label}
                  className="cursor-not-allowed"
                  title="Coming in a later milestone"
                >
                  {m.label}
                </span>
              ),
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div>{profile.full_name ?? user.email}</div>
            <div className="text-zinc-400">
              {roleLabel} · {profile.campaigns?.name}
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">
          {profile.campaigns?.name}
        </h1>
        <p className="text-sm text-zinc-400">
          {profile.campaigns?.state} · Signed in as {user.email} ({roleLabel}).
          M0 foundation — modules come online in M1+.
        </p>
      </main>
    </div>
  );
}
