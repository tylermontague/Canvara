import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { fetchPersuasionProfile } from "@canvara/shared";

export default async function VoterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: voter } = await supabase
    .from("voters")
    .select(
      "id, external_id, first_name, last_name, address, city, zip, precinct, party, birth_year, gender, vote_history",
    )
    .eq("id", id)
    .maybeSingle();
  if (!voter) notFound();

  const { data: conversations } = await supabase
    .from("conversations")
    .select(
      "id, recorded_at, status, contact_result, transcript, profiles!conversations_canvasser_id_fkey(full_name), signals(id, support_level, persuadability, emotional_valence, top_issues, debrief_summary, confidence_score, canvasser_confirmed)",
    )
    .eq("voter_id", id)
    .order("recorded_at", { ascending: false });

  const convos = conversations ?? [];
  const latestWithSignal = convos.find((c) => c.signals);
  const latestSignal = latestWithSignal?.signals ?? null;

  const voteHistory = (voter.vote_history as Record<string, boolean> | null) ?? {};
  const voteEntries = Object.entries(voteHistory)
    .filter(([, v]) => v)
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));

  const age =
    voter.birth_year != null ? new Date().getFullYear() - voter.birth_year : null;

  const persuasionProfile = await fetchPersuasionProfile(supabase, voter.id);
  const topBeliefs = persuasionProfile.beliefs.slice(0, 5);
  const resonanceRows = persuasionProfile.resonanceHistory
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const RESONANCE_CLASS: Record<string, string> = {
    positive: "text-green-700",
    negative: "text-red-600",
  };

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">
            {voter.first_name} {voter.last_name}
          </h1>
          <p className="text-sm text-slate">
            {voter.address}, {voter.city} {voter.zip} · {voter.precinct} · {voter.party}
            {age != null ? ` · ${age}` : ""} ·{" "}
            <span className="font-mono">{voter.external_id}</span>
          </p>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-3 font-serif text-lg font-bold text-navy">Vote history</h2>
            {voteEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {voteEntries.map(([key]) => (
                  <span
                    key={key}
                    className="rounded-lg border border-rule bg-stone px-3 py-1 text-xs text-ink"
                  >
                    {key.replace(/_/g, " ")} ✓
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate">No vote history on file.</p>
            )}
          </section>

          {latestSignal && (
            <section className="rounded-xl border border-rule bg-white p-5">
              <h2 className="mb-3 font-serif text-lg font-bold text-navy">Latest read</h2>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    ["Support level", latestSignal.support_level],
                    ["Persuadability", latestSignal.persuadability],
                    ["Emotional valence", latestSignal.emotional_valence],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                      {label}
                    </div>
                    <div className="text-sm text-ink">
                      {value ? value.replace(/_/g, " ") : "—"}
                    </div>
                  </div>
                ))}
              </div>

              {latestSignal.top_issues && latestSignal.top_issues.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {latestSignal.top_issues.map((issue) => (
                    <span
                      key={issue}
                      className="rounded-lg bg-navy px-3 py-1 text-xs text-white"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              )}

              {latestSignal.debrief_summary && (
                <p className="mb-4 text-sm leading-relaxed text-ink">
                  {latestSignal.debrief_summary}
                </p>
              )}

              <p className="text-sm text-slate">
                confidence{" "}
                <span className="font-mono">{latestSignal.confidence_score.toFixed(2)}</span> ·{" "}
                {latestSignal.canvasser_confirmed ? "confirmed by canvasser" : "unconfirmed"}
              </p>
            </section>
          )}

          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-3 font-serif text-lg font-bold text-navy">Persuasion profile</h2>

            <div className="mb-4">
              <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                What we've learned in person
              </p>
              {persuasionProfile.personalContext.length > 0 ? (
                <ul className="space-y-1">
                  {persuasionProfile.personalContext.map((fact, i) => (
                    <li key={i} className="text-sm text-ink">
                      · {fact}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate">Nothing captured yet.</p>
              )}
            </div>

            {persuasionProfile.observedAttributes.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                  Observed at the door
                </p>
                <div className="flex flex-wrap gap-2">
                  {persuasionProfile.observedAttributes.map((attr, i) => (
                    <span
                      key={i}
                      className="rounded-lg bg-stone px-3 py-1 text-xs text-ink"
                      title={`source: ${attr.source}`}
                    >
                      {attr.key}: {attr.value}{" "}
                      <span className="text-slate">({attr.source})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                Likely issue levers
              </p>
              {topBeliefs.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {topBeliefs.map((belief) => (
                    <span
                      key={belief.issue}
                      className="rounded-lg bg-navy px-3 py-1 text-xs text-white"
                    >
                      {belief.issue.replace(/_/g, " ")} · {Math.round(belief.mean * 100)}%
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate">No beliefs modeled yet.</p>
              )}
            </div>

            <div className="mb-4">
              <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                Message resonance
              </p>
              {resonanceRows.length > 0 ? (
                <div className="space-y-2">
                  {resonanceRows.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 border-t border-rule pt-2 first:border-t-0 first:pt-0"
                    >
                      <span className="truncate text-sm text-ink">{r.message}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span
                          className={`text-xs ${RESONANCE_CLASS[r.response] ?? "text-slate"}`}
                        >
                          {r.response}
                        </span>
                        <span className="text-xs text-slate">
                          {new Date(r.at).toLocaleDateString()}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate">No messages tried yet.</p>
              )}
            </div>

            <p className="text-xs text-slate italic">
              Personal evidence overrides cohort inference in all messaging.
            </p>
          </section>

          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-3 font-serif text-lg font-bold text-navy">Conversations</h2>
            {convos.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left">
                    <tr>
                      {["Date", "Canvasser", "Result", "Status", "Support", ""].map((h) => (
                        <th
                          key={h}
                          className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {convos.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t border-rule transition-colors duration-200 ease-out hover:bg-stone"
                      >
                        <td className="px-3 py-1.5">
                          {new Date(c.recorded_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5">{c.profiles?.full_name ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {c.contact_result ? c.contact_result.replace(/_/g, " ") : "—"}
                        </td>
                        <td className="px-3 py-1.5">{c.status}</td>
                        <td className="px-3 py-1.5">
                          {c.signals?.support_level
                            ? c.signals.support_level.replace(/_/g, " ")
                            : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {c.transcript != null && (
                            <Link
                              href={`/conversations/${c.id}`}
                              className="text-navy underline-offset-2 hover:underline"
                            >
                              Transcript →
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate">No conversations at this door yet.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
