import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function WalkListsPage() {
  const supabase = await createClient();

  const { data: lists, error } = await supabase
    .from("walk_lists")
    .select("id, name, created_at, profiles(full_name, role), walk_list_items(count)")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
            ← Console
          </Link>
          <h1 className="text-2xl font-semibold">Walk lists</h1>
        </div>
        <div className="flex gap-3">
          <Link
            href="/voters"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Voters
          </Link>
          <Link
            href="/walk-lists/new"
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            New walk list
          </Link>
        </div>
      </div>

      {error ? (
        <p className="text-red-400">{error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Assigned to</th>
                <th className="px-3 py-2 font-medium">Stops</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {(lists ?? []).map((l) => (
                <tr key={l.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-3 py-2">
                    <Link href={`/walk-lists/${l.id}`} className="text-zinc-100 underline-offset-2 hover:underline">
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {l.profiles?.full_name ?? <span className="text-zinc-500">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2">{l.walk_list_items?.[0]?.count ?? 0}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(lists ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                    No walk lists yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
