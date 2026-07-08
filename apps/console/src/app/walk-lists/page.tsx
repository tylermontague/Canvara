import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";

export default async function WalkListsPage() {
  const supabase = await createClient();

  const { data: lists, error } = await supabase
    .from("walk_lists")
    .select("id, name, created_at, profiles(full_name, role), walk_list_items(count)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold text-navy">Walk lists</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/voters"
              className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
            >
              Voters
            </Link>
            <Link
              href="/walk-lists/new"
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover"
            >
              New walk list
            </Link>
          </div>
        </div>

        {error ? (
          <p className="text-red-600">{error.message}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-rule bg-white">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  <th className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    Name
                  </th>
                  <th className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    Assigned to
                  </th>
                  <th className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    Stops
                  </th>
                  <th className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {(lists ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-rule transition-colors duration-200 ease-out hover:bg-stone">
                    <td className="px-3 py-2">
                      <Link href={`/walk-lists/${l.id}`} className="text-navy underline-offset-2 hover:underline">
                        {l.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {l.profiles?.full_name ?? <span className="text-slate">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink">{l.walk_list_items?.[0]?.count ?? 0}</td>
                    <td className="px-3 py-2 text-slate">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {(lists ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate">
                      No walk lists yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
