import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";

interface Utterance {
  speaker: string;
  text: string;
  ts: number;
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: convo } = await supabase
    .from("conversations")
    .select(
      "id, voter_id, recorded_at, status, contact_result, consent_disclosed_at, transcript, wer_estimate, voters(first_name, last_name, address, city), profiles!conversations_canvasser_id_fkey(full_name), signals(support_level, persuadability, emotional_valence, top_issues, debrief_summary, confidence_score, model_used, canvasser_confirmed)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!convo) notFound();

  const voter = convo.voters;
  const signal = convo.signals;
  const transcript = (convo.transcript as unknown as Utterance[] | null) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="flex-1 p-6">
        {convo.voter_id && (
          <Link
            href={`/voters/${convo.voter_id}`}
            className="mb-4 inline-block text-sm text-navy underline-offset-2 hover:underline"
          >
            ← Back to voter
          </Link>
        )}

        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">
            {voter ? `${voter.first_name} ${voter.last_name}` : "Unmatched door"}
          </h1>
          <p className="text-sm text-slate">
            {new Date(convo.recorded_at).toLocaleString()} ·{" "}
            {convo.profiles?.full_name ?? "Unknown canvasser"} ·{" "}
            {convo.contact_result ? convo.contact_result.replace(/_/g, " ") : "—"} ·{" "}
            {convo.status} ·{" "}
            {convo.consent_disclosed_at ? (
              new Date(convo.consent_disclosed_at).toLocaleString()
            ) : (
              <span className="text-red-600">no disclosure logged</span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-3 font-serif text-lg font-bold text-navy">Transcript</h2>
            <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-2">
              {transcript.map((u, i) => (
                <div key={i}>
                  <span className="font-mono text-[11px] tracking-[0.08em] text-slate uppercase">
                    {u.speaker}
                  </span>
                  <p className="text-sm leading-relaxed text-ink">{u.text}</p>
                </div>
              ))}
              {transcript.length === 0 && (
                <p className="text-sm text-slate">No transcript stored.</p>
              )}
            </div>
            {convo.wer_estimate != null && (
              <p className="mt-3 text-xs text-slate">
                est. transcription error: {(convo.wer_estimate * 100).toFixed(1)}%
              </p>
            )}
          </section>

          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-3 font-serif text-lg font-bold text-navy">Extracted read</h2>
            {signal ? (
              <>
                {signal.debrief_summary && (
                  <p className="mb-4 text-sm leading-relaxed text-ink">
                    {signal.debrief_summary}
                  </p>
                )}

                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(
                    [
                      ["Support level", signal.support_level],
                      ["Persuadability", signal.persuadability],
                      ["Emotional valence", signal.emotional_valence],
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

                {signal.top_issues && signal.top_issues.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {signal.top_issues.map((issue) => (
                      <span
                        key={issue}
                        className="rounded-lg bg-navy px-3 py-1 text-xs text-white"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-sm text-slate">
                  confidence{" "}
                  <span className="font-mono">{signal.confidence_score.toFixed(2)}</span> ·{" "}
                  <span className="font-mono">{signal.model_used}</span>
                </p>
                <p className="mt-1 text-sm text-slate">
                  {signal.canvasser_confirmed ? "Confirmed by canvasser" : "Awaiting debrief"}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate">Not extracted yet.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
