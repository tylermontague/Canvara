import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";

// Review queue (IE-8): low-confidence extractions awaiting human
// adjudication. First room of the Voter Intelligence Lab.
export default async function ReviewQueuePage() {
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from("review_queue")
    .select(
      "id, reason, created_at, conversations(id, recorded_at, voters(first_name, last_name), signals(id, confidence_score, support_level, model_used))",
    )
    .eq("status", "open")
    .order("created_at", { ascending: true });

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Review queue</h1>
          <p className="text-sm text-slate">
            Conversations the pipeline wasn&apos;t confident about. Your decision is final
            and becomes training data.
          </p>
        </div>

        {error ? (
          <p className="text-red-600">{error.message}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-rule bg-white">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  {["Voter", "Recorded", "Reason", "Confidence", "Model", ""].map((h, i) => (
                    <th
                      key={i}
                      className="border-b border-rule px-3 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((item) => {
                  const convo = item.conversations;
                  const signal = convo?.signals;
                  const voter = convo?.voters;
                  return (
                    <tr
                      key={item.id}
                      className="border-t border-rule transition-colors duration-200 ease-out hover:bg-stone"
                    >
                      <td className="px-3 py-2 text-ink">
                        {voter
                          ? `${voter.last_name}, ${voter.first_name}`
                          : "Unmatched door"}
                      </td>
                      <td className="px-3 py-2 text-slate">
                        {convo ? new Date(convo.recorded_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-ink">{item.reason.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 font-mono text-ink">
                        {signal ? signal.confidence_score.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate">
                        {signal?.model_used ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/review/${item.id}`}
                          className="text-navy underline-offset-2 hover:underline"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {(items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate">
                      Queue is clear — nothing needs review.
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
