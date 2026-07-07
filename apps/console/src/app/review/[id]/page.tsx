import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { AdjudicationForm } from "./adjudication-form";

interface Utterance {
  speaker: string;
  text: string;
  ts: number;
}

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("review_queue")
    .select(
      "id, reason, status, campaign_id, conversations(id, recorded_at, transcript, wer_estimate, voters(first_name, last_name, address, city), signals(id, debrief_summary, support_level, persuadability, emotional_valence, top_issues, confidence_score, model_used, prompt_version))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!item || !item.conversations?.signals) notFound();

  const convo = item.conversations!;
  const signal = convo.signals!;
  const voter = convo.voters;
  const transcript = (convo.transcript as unknown as Utterance[]) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">
            {voter ? `${voter.first_name} ${voter.last_name}` : "Unmatched door"}
          </h1>
          <p className="text-sm text-slate">
            {voter ? `${voter.address}, ${voter.city} · ` : ""}
            {new Date(convo.recorded_at).toLocaleString()} · {item.reason.replace(/_/g, " ")} ·
            confidence <span className="font-mono">{signal.confidence_score.toFixed(2)}</span> ·{" "}
            <span className="font-mono">{signal.model_used}</span> ·{" "}
            <span className="font-mono">{signal.prompt_version}</span>
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
          </section>

          <section className="rounded-xl border border-rule bg-white p-5">
            <h2 className="mb-1 font-serif text-lg font-bold text-navy">
              Extracted read
            </h2>
            {signal.debrief_summary && (
              <p className="mb-4 text-sm leading-relaxed text-ink">
                {signal.debrief_summary}
              </p>
            )}
            <AdjudicationForm
              reviewId={item.id}
              signalId={signal.id}
              conversationId={convo.id}
              campaignId={item.campaign_id}
              isOpen={item.status === "open"}
              initial={{
                support_level: signal.support_level,
                persuadability: signal.persuadability,
                emotional_valence: signal.emotional_valence,
                top_issues: signal.top_issues ?? [],
              }}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
