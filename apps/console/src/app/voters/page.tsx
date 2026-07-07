import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type Search = {
  q?: string;
  city?: string;
  zip?: string;
  precinct?: string;
  party?: string;
  page?: string;
};

export default async function VotersPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("voters")
    .select("id, external_id, first_name, last_name, address, city, zip, precinct, party", {
      count: "exact",
    });

  if (params.q) {
    query = query.or(`last_name.ilike.%${params.q}%,first_name.ilike.%${params.q}%`);
  }
  if (params.city) query = query.ilike("city", `%${params.city}%`);
  if (params.zip) query = query.like("zip", `${params.zip}%`);
  if (params.precinct) query = query.eq("precinct", params.precinct);
  if (params.party) query = query.eq("party", params.party);

  const from = (page - 1) * PAGE_SIZE;
  const { data: voters, count, error } = await query
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `/voters?${sp.toString()}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
            ← Console
          </Link>
          <h1 className="text-2xl font-semibold">Voters</h1>
          <p className="text-sm text-zinc-400">
            {total.toLocaleString()} voter{total === 1 ? "" : "s"} in your campaign
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/walk-lists"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Walk lists
          </Link>
          <Link
            href="/voters/import"
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            Import voter file
          </Link>
        </div>
      </div>

      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["q", "Name", params.q],
            ["city", "City", params.city],
            ["zip", "ZIP", params.zip],
            ["precinct", "Precinct", params.precinct],
            ["party", "Party", params.party],
          ] as const
        ).map(([name, label, value]) => (
          <input
            key={name}
            name={name}
            placeholder={label}
            defaultValue={value ?? ""}
            className="w-36 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-400"
          />
        ))}
        <button className="rounded-md border border-zinc-600 px-4 py-1.5 text-sm hover:bg-zinc-800">
          Filter
        </button>
        <Link
          href="/voters"
          className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          Clear
        </Link>
      </form>

      {error ? (
        <p className="text-red-400">{error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-zinc-400">
              <tr>
                {["Last name", "First name", "Address", "City", "ZIP", "Precinct", "Party", "Ext. ID"].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(voters ?? []).map((v) => (
                <tr key={v.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-3 py-1.5">{v.last_name}</td>
                  <td className="px-3 py-1.5">{v.first_name}</td>
                  <td className="px-3 py-1.5">{v.address}</td>
                  <td className="px-3 py-1.5">{v.city}</td>
                  <td className="px-3 py-1.5">{v.zip}</td>
                  <td className="px-3 py-1.5">{v.precinct}</td>
                  <td className="px-3 py-1.5">{v.party}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{v.external_id}</td>
                </tr>
              ))}
              {(voters ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                    No voters yet — import a voter file to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={pageLink(page - 1)} className="text-zinc-300 hover:text-white">
              ← Prev
            </Link>
          )}
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageLink(page + 1)} className="text-zinc-300 hover:text-white">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
