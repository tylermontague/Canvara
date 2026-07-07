import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@canvara/db";

/** Server-side Supabase client bound to the request's auth cookies. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — session refresh is handled by
            // the proxy, so this can be safely ignored.
          }
        },
      },
    },
  );
}
