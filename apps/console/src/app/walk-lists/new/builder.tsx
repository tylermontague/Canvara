"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { orderStops } from "@canvara/shared";
import { createClient } from "@/lib/supabase/client";

const CANDIDATE_LIMIT = 500;
const BATCH_SIZE = 500;

interface Candidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  precinct: string | null;
  party: string | null;
}

interface Assignee {
  id: string;
  full_name: string | null;
  role: string;
}

const EMPTY_FILTERS = { q: "", city: "", zip: "", precinct: "", party: "" };

export function WalkListBuilder() {
  const router = useRouter();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [totalMatching, setTotalMatching] = useState(0);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("id, full_name, role")
      .then(({ data }) => {
        const sorted = (data ?? []).sort(
          (a, b) => (a.role === "canvasser" ? 0 : 1) - (b.role === "canvasser" ? 0 : 1),
        );
        setAssignees(sorted);
      });
  }, []);

  async function search() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("voters")
      .select("id, first_name, last_name, address, city, zip, precinct, party", {
        count: "exact",
      });
    if (filters.q)
      query = query.or(`last_name.ilike.%${filters.q}%,first_name.ilike.%${filters.q}%`);
    if (filters.city) query = query.ilike("city", `%${filters.city}%`);
    if (filters.zip) query = query.like("zip", `${filters.zip}%`);
    if (filters.precinct) query = query.eq("precinct", filters.precinct);
    if (filters.party) query = query.eq("party", filters.party);

    const { data, count, error } = await query
      .order("zip")
      .order("address")
      .limit(CANDIDATE_LIMIT);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCandidates(data ?? []);
    setTotalMatching(count ?? 0);
    setExcluded(new Set());
  }

  const included = (candidates ?? []).filter((c) => !excluded.has(c.id));

  async function create() {
    if (!name.trim() || included.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in.");
      setBusy(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("campaign_id")
      .eq("id", user.id)
      .single();
    if (!profile) {
      setError("Could not load your campaign profile.");
      setBusy(false);
      return;
    }

    const { data: list, error: listError } = await supabase
      .from("walk_lists")
      .insert({
        campaign_id: profile.campaign_id,
        name: name.trim(),
        assigned_to: assignedTo || null,
      })
      .select("id")
      .single();
    if (listError || !list) {
      setError(listError?.message ?? "Failed to create walk list.");
      setBusy(false);
      return;
    }

    const ordered = orderStops(included);
    const items = ordered.map((v, i) => ({
      campaign_id: profile.campaign_id,
      walk_list_id: list.id,
      voter_id: v.id,
      position: i + 1,
    }));
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const { error: itemsError } = await supabase
        .from("walk_list_items")
        .insert(items.slice(i, i + BATCH_SIZE));
      if (itemsError) {
        setError(`Stops failed to save: ${itemsError.message}`);
        setBusy(false);
        return;
      }
    }

    router.push(`/walk-lists/${list.id}`);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h2 className="mb-2 font-serif text-lg font-bold text-navy">1. Find voters</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["q", "Name"],
              ["city", "City"],
              ["zip", "ZIP"],
              ["precinct", "Precinct"],
              ["party", "Party"],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              placeholder={label}
              value={filters[key]}
              onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
              className="w-36 rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
            />
          ))}
          <button
            onClick={() => void search()}
            disabled={busy}
            className="rounded-lg border border-rule bg-white px-4 py-1.5 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
          >
            Search
          </button>
        </div>
        {candidates && (
          <p className="mt-2 text-sm text-slate">
            {totalMatching.toLocaleString()} match
            {totalMatching > CANDIDATE_LIMIT
              ? ` — showing the first ${CANDIDATE_LIMIT}; narrow the filters for larger turfs`
              : ""}
          </p>
        )}
      </section>

      {candidates && candidates.length > 0 && (
        <>
          <section>
            <h2 className="mb-2 font-serif text-lg font-bold text-navy">
              2. Stops{" "}
              <span className="font-sans text-sm font-normal text-slate">
                ({included.length} of {candidates.length} included)
              </span>
            </h2>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-rule bg-white">
              <table className="w-full text-sm">
                <tbody>
                  {candidates.map((v) => {
                    const isIncluded = !excluded.has(v.id);
                    return (
                      <tr key={v.id} className="border-t border-rule first:border-t-0">
                        <td className="w-8 px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(v.id)) next.delete(v.id);
                                else next.add(v.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className={`px-3 py-1.5 ${isIncluded ? "text-ink" : "text-slate line-through"}`}>
                          {v.last_name}, {v.first_name}
                        </td>
                        <td className={`px-3 py-1.5 ${isIncluded ? "text-slate" : "text-slate/60"}`}>
                          {v.address}, {v.city} {v.zip}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-lg font-bold text-navy">3. Name & assign</h2>
            <div className="flex flex-wrap gap-3">
              <input
                placeholder="Walk list name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-64 rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
              />
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-64 rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink"
              >
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name ?? a.id} ({a.role})
                  </option>
                ))}
              </select>
              <button
                onClick={() => void create()}
                disabled={busy || !name.trim() || included.length === 0}
                className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
              >
                {busy ? "Creating…" : `Create with ${included.length} stops`}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </section>
        </>
      )}
    </div>
  );
}
