import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import {
  fetchStanding,
  fetchSurveyBreakouts,
  STANDING_DIMENSIONS,
  type ScenarioAssumptions,
} from "@canvara/shared";
import { Simulator, type ScenarioSegmentSeed, type SavedScenarioRow } from "./simulator";
import { savePollPriorForm } from "./actions";

type Search = { dimension?: string };

const DIMENSION_KEYS = new Set(STANDING_DIMENSIONS.map((d) => d.key));

function fmtPct(pct: number | null, digits = 1): string {
  return pct === null ? "—" : `${pct.toFixed(digits)}%`;
}

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const dimension =
    params.dimension && DIMENSION_KEYS.has(params.dimension) ? params.dimension : "party";

  const [standing, breakouts, scenariosRes] = await Promise.all([
    fetchStanding(supabase, dimension, 2026),
    fetchSurveyBreakouts(supabase, dimension),
    supabase
      .from("scenarios")
      .select("id, name, dimension, assumptions, notes, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const savedScenarios: SavedScenarioRow[] = (scenariosRes.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    dimension: row.dimension,
    assumptions: row.assumptions as unknown as ScenarioAssumptions,
    created_at: row.created_at,
  }));

  const initialSegments: ScenarioSegmentSeed[] = standing.segments.map((s) => {
    let ourSharePct: number;
    let baselineSource: ScenarioSegmentSeed["baselineSource"];
    if (!s.insufficientSample && s.ourSharePct !== null) {
      ourSharePct = s.ourSharePct;
      baselineSource = "door";
    } else if (s.pollPriorPct !== null) {
      ourSharePct = s.pollPriorPct;
      baselineSource = "poll";
    } else {
      ourSharePct = 50;
      baselineSource = "assumed";
    }
    return {
      key: s.key,
      label: s.label,
      registered: s.registered,
      turnoutPct: s.lastSimilarTurnoutPct ?? 40,
      ourSharePct,
      baselineSource,
      turnoutSource: s.lastSimilarTurnoutPct !== null ? "history" : "assumed",
    };
  });

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link
              href="/lab"
              className="mb-1 inline-block text-xs text-slate transition-colors duration-200 ease-out hover:text-navy"
            >
              ← Voter Intelligence Lab
            </Link>
            <h1 className="font-serif text-2xl font-bold text-navy">Scenarios</h1>
            <p className="text-sm text-slate">
              How we&apos;re standing, and what it takes to win.
            </p>
          </div>
        </div>

        {/* Dimension tabs */}
        <div className="mb-4 flex flex-wrap gap-2 border-b border-rule pb-3">
          {STANDING_DIMENSIONS.map((d) => {
            const active = d.key === dimension;
            return (
              <Link
                key={d.key}
                href={`/lab/scenarios?dimension=${d.key}`}
                className={
                  active
                    ? "rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 ease-out"
                    : "rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
                }
              >
                {d.label}
              </Link>
            );
          })}
        </div>

        {/* How are we doing */}
        <section className="mb-6 rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">How are we doing</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  {["Segment", "Registered", "Turnout (last similar cycle)", "Our share at the door", "Poll prior"].map(
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
                {standing.segments.map((s) => (
                  <tr key={s.key} className="border-t border-rule align-top">
                    <td className="px-2 py-3 text-ink">{s.label}</td>
                    <td className="px-2 py-3 font-mono text-ink">
                      {s.registered.toLocaleString()}
                    </td>
                    <td className="px-2 py-3 font-mono text-ink">
                      {fmtPct(s.lastSimilarTurnoutPct)}
                    </td>
                    <td className="px-2 py-3">
                      {s.insufficientSample || s.ourSharePct === null ? (
                        <span className="text-xs text-slate">
                          n={s.supportSample} — too few reads
                        </span>
                      ) : (
                        <span className="font-mono text-ink">
                          {fmtPct(s.ourSharePct)}{" "}
                          <span className="text-xs text-slate">(n={s.supportSample})</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="mb-2 font-mono text-ink">
                        {s.pollPriorPct !== null ? (
                          <>
                            {fmtPct(s.pollPriorPct)}{" "}
                            {s.pollPriorSource && (
                              <span className="text-xs text-slate">· {s.pollPriorSource}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate">—</span>
                        )}
                      </div>
                      <form
                        action={savePollPriorForm}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <input type="hidden" name="dimension" value={dimension} />
                        <input type="hidden" name="segment" value={s.key} />
                        <input
                          type="number"
                          name="ourSharePct"
                          min={0}
                          max={100}
                          step={0.1}
                          defaultValue={s.pollPriorPct ?? undefined}
                          placeholder="%"
                          className="w-16 rounded border border-rule bg-white px-1.5 py-1 text-xs text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
                        />
                        <input
                          type="text"
                          name="source"
                          defaultValue={s.pollPriorSource ?? ""}
                          placeholder="source"
                          className="w-28 rounded border border-rule bg-white px-1.5 py-1 text-xs text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
                        />
                        <button
                          type="submit"
                          className="rounded border border-rule bg-white px-2 py-1 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* What-if simulator */}
        <div className="mb-6">
          {/* Keyed by dimension: slider state must reset when the segment
              set changes, or old-dimension keys leak into the new one. */}
          <Simulator
            key={dimension}
            dimension={dimension}
            initialSegments={initialSegments}
            savedScenarios={savedScenarios}
          />
        </div>

        {/* Door-poll breakouts */}
        <section className="rounded-xl border border-rule bg-white p-5">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Door-poll breakouts</h2>
          {breakouts.every((b) => b.totalResponses === 0) ? (
            <p className="text-sm text-slate">No door-poll responses yet.</p>
          ) : (
            <div className="space-y-6">
              {breakouts
                .filter((b) => b.totalResponses > 0)
                .map((b) => {
                  const segmentKeys = Object.keys(b.bySegment);
                  const answerKeys = new Set<string>(b.options);
                  for (const answers of Object.values(b.bySegment)) {
                    for (const key of Object.keys(answers)) answerKeys.add(key);
                  }
                  const columns = [...answerKeys];
                  return (
                    <div key={b.questionId}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <h3 className="text-sm font-medium text-ink">{b.question}</h3>
                        <span className="text-xs text-slate">
                          {b.totalResponses} response{b.totalResponses === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left">
                            <tr>
                              <th className="border-b border-rule px-2 py-1.5 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                                Segment
                              </th>
                              {columns.map((col) => (
                                <th
                                  key={col}
                                  className="border-b border-rule px-2 py-1.5 text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
                                >
                                  {col.replace(/_/g, " ")}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {segmentKeys.map((segKey) => {
                              const label =
                                standing.segments.find((s) => s.key === segKey)?.label ?? segKey;
                              return (
                                <tr key={segKey} className="border-t border-rule">
                                  <td className="px-2 py-1.5 text-ink">{label}</td>
                                  {columns.map((col) => (
                                    <td key={col} className="px-2 py-1.5 font-mono text-ink">
                                      {b.bySegment[segKey]?.[col] ?? 0}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
