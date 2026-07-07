"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white transition-colors duration-200 ease-out hover:bg-navy-light"
    >
      Sign out
    </button>
  );
}
