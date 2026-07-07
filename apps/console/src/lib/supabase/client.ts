import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@canvara/db";

/** Browser-side Supabase client (RLS-enforced via the anon key). */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
