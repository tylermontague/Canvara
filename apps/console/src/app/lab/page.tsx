import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import {
  fetchSupportDistribution,
  fetchIssueSalience,
  fetchDailyTrend,
  PULSE_MIN_SAMPLE,
  ISSUE_MIN_MENTIONS,
  SUPPORT_LEVELS,
} from "@canvara/shared";
import { TrendChart } from "./trend-chart";

// Ambient Pulse tier 1 (CC-1): support distribution, issue salience, trend.
// Nonpartisan data palette: navy shades for support, warm neutrals for
// opposition — never red/blue. Gold appears once (net-support line).
const LEVEL_COLORS: Record<string, string> = {
  strong_support: "#0F2A4A",
  lean_support: "#3D5C7E",
  undecided: "#C9C7BD",
  lean_oppose: "#C9A47E",
  strong_oppose: "#8F5B3F",
};

const LEVEL_LABELS: Record<string, string> = {
  strong_support: "Strong support",
  lean_support: "Lean support",
  undecided: "Undecided",
  lean_oppose: "Lean oppose",
  strong_oppose: "Strong oppose",
  unknown: "Unknown",
};

export default async function LabPage() {
  const supabase = await createClient();

  const [distribution, issues, trend, reviewCount] = await Promise.all([
    fetchSupportDistribution(supabase),
    fetchIssueSalience(supabase),
    fetchDailyTrend(supabase),
    supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then((r) => r.count ?? 0),
  ]);

  // "unknown" is tracked but not charted as stance.
  const stanceLevels = SUPPORT_LEVELS.filter((l) => l !== "unknown");
  const stanceTotal = stanceLevels.reduce((sum, l) => sum + (distribution.counts[l] ?? 0), 0);

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold text-navy">Voter Intelligence Lab</h1>
            <p className="text-sm text-slate">
              Ambient Pulse — what {distribution.total.toLocaleString()} conversation
              {distribution.total === 1 ? "" : "s"} are saying.
            </p>
          </div>
          <Link
            href="/review"
            className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
          >
            Review queue{reviewCount > 0 ? ` (${reviewCount})` : ""}
          </Link>
        </div>

        {/* Support distribution */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-lg font-bold text-navy">Support distribution</h2>
            {distribution.insufficientSample && (
              <span className="text-xs text-slate">
                insufficient sample — {distribution.total} of {PULSE_MIN_SAMPLE} needed for
                reliable shares
              </span>
            )}
          </div>
          <div className={distribution.insufficientSample ? "opacity-40" : ""}>
            <div className="flex h-8 w-full overflow-hidden rounded-lg">
              {stanceLevels.map((level) => {
                const n = distribution.counts[level] ?? 0;
                const pct = stanceTotal > 0 ? (n / stanceTotal) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div
                    key={level}
                    style={{ width: `${pct}%`, backgroundColor: LEVEL_COLORS[level] }}
                    title={`${LEVEL_LABELS[level]}: ${n}`}
                  />
                );
              })}
              {stanceTotal === 0 && <div className="w-full bg-stone" />}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              {stanceLevels.map((level) => {
                const n = distribution.counts[level] ?? 0;
                const pct = stanceTotal > 0 ? Math.round((n / stanceTotal) * 100) : 0;
                return (
                  <span key={level} className="flex items-center gap-1.5 text-xs text-ink">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: LEVEL_COLORS[level] }}
                    />
                    {LEVEL_LABELS[level]}{" "}
                    <span className="font-mono">
                      {n}
                      {!distribution.insufficientSample && stanceTotal > 0 ? ` · ${pct}%` : ""}
                    </span>
                  </span>
                );
              })}
              {(distribution.counts["unknown"] ?? 0) > 0 && (
                <span className="text-xs text-slate">
                  + {distribution.counts["unknown"]} unknown
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Trend */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-1 font-serif text-lg font-bold text-navy">Conversation trend</h2>
          <p className="mb-3 text-xs text-slate">
            Daily conversation volume (navy) and net support (gold, right axis) — net support
            hidden on days under 5 conversations.
          </p>
          <TrendChart days={trend} />
        </section>

        {/* Issue salience */}
        <section className="rounded-xl border border-rule bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-lg font-bold text-navy">Issue salience</h2>
            <span className="text-xs text-slate">
              ordered by unprompted mentions — the ambient signal
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                {["Issue", "Mentions", "Raised unprompted", "Sentiment (neg / neutral / pos)"].map(
                  (h) => (
                    <th
                      key={h}
                      className="border-b border-rule px-2 py-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const spontaneousPct =
                  issue.mentions > 0 ? Math.round((issue.spontaneous / issue.mentions) * 100) : 0;
                const sentimentTotal = issue.negative + issue.positive + issue.neutralMixed;
                return (
                  <tr
                    key={issue.issue}
                    className={`border-t border-rule ${issue.insufficientSample ? "opacity-40" : ""}`}
                    title={
                      issue.insufficientSample
                        ? `Fewer than ${ISSUE_MIN_MENTIONS} mentions — not yet reliable`
                        : undefined
                    }
                  >
                    <td className="px-2 py-2 text-ink">{issue.issue.replace(/_/g, " ")}</td>
                    <td className="px-2 py-2 font-mono text-ink">{issue.mentions}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-stone">
                          <div
                            className="h-full bg-navy"
                            style={{ width: `${spontaneousPct}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-slate">{spontaneousPct}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {sentimentTotal > 0 ? (
                        <div className="flex h-2 w-36 overflow-hidden rounded-full">
                          <div
                            className="bg-[#8F5B3F]"
                            style={{ width: `${(issue.negative / sentimentTotal) * 100}%` }}
                            title={`negative: ${issue.negative}`}
                          />
                          <div
                            className="bg-[#C9C7BD]"
                            style={{ width: `${(issue.neutralMixed / sentimentTotal) * 100}%` }}
                            title={`neutral/mixed: ${issue.neutralMixed}`}
                          />
                          <div
                            className="bg-[#3D5C7E]"
                            style={{ width: `${(issue.positive / sentimentTotal) * 100}%` }}
                            title={`positive: ${issue.positive}`}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-slate">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-8 text-center text-slate">
                    No issues extracted yet — signals appear here as conversations are processed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
