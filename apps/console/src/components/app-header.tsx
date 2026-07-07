import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@canvara/shared";
import { SignOutButton } from "@/app/sign-out-button";

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
  { label: "Voter Intelligence Lab", href: "/lab" },
  { label: "Message Lab" },
  { label: "Voter Contact Workshop" },
  { label: "Admin" },
];

export async function AppHeader() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let identityLabel: string | null = null;
  let roleLine: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, campaigns(name)")
      .eq("id", user.id)
      .single();

    if (profile) {
      const roleLabel = ROLE_LABELS[profile.role as Role] ?? profile.role;
      identityLabel = profile.full_name ?? user.email ?? "";
      roleLine = `${roleLabel} · ${profile.campaigns?.name ?? ""}`;
    } else {
      identityLabel = user.email ?? "";
    }
  }

  return (
    <header className="flex min-h-[60px] items-center justify-between gap-4 bg-navy px-6 py-2">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center">
          <Image
            src="/brand/canvara-lockup-dark.svg"
            alt="Canvara"
            width={160}
            height={40}
            className="h-10 w-auto"
            priority
          />
        </Link>
        <nav className="hidden gap-5 text-sm md:flex">
          {MODULES.map((m) =>
            m.href ? (
              <Link
                key={m.label}
                href={m.href}
                className="text-white transition-colors duration-200 ease-out hover:text-white/70"
              >
                {m.label}
              </Link>
            ) : (
              <span
                key={m.label}
                className="cursor-not-allowed text-white/40"
                title="Coming in a later milestone"
              >
                {m.label}
              </span>
            ),
          )}
        </nav>
      </div>
      {user && (
        <div className="flex items-center gap-4">
          <div className="text-right text-sm text-white">
            <div>{identityLabel}</div>
            {roleLine && <div className="text-white/60">{roleLine}</div>}
          </div>
          <SignOutButton />
        </div>
      )}
    </header>
  );
}
