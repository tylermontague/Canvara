import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { COHORT_DIMENSIONS, evaluateCohort, type CohortDefinition } from "@canvara/shared";

// Same nonpartisan support palette as /lab — navy shades for support, warm
// neutrals for opposition, never red/blue.
const LEVEL_COLORS: Record<string, string> = {
  strong_support: "#0F2A4A",
  lean_support: "#3D5C7E",
  undecided: "#C9C7BD",
  lean_oppose: "#C9A47E",
  strong_oppose: "#8F5B3F",
};

const LEVEL_ORDER = [
  "strong_support",
  "lean_support",
  "undecided",
  "lean_oppose",
  "strong_oppose",
] as const;

const DIMENSION_BY_KEY = new Map(COHORT_DIMENSIONS.map((d) => [d.key, d]));

function summarizeDefinition(definition: CohortDefinition): string {
  const parts: string[] = [];

  for (const [key, values] of Object.entries(definition.demographics ?? {})) {
    if (!values || values.length === 0) continue;
    const dimension = DIMENSION_BY_KEY.get(key);
    const optionByValue = new Map((dimension?.options ?? []).map((o) => [o.value, o.label]));
    const labels = values.map((v) => optionByValue.get(v) ?? v);
    parts.push(labels.join(" or "));
  }

  for (const stance of definition.issue_stances ?? []) {
    if (!stance.sentiments || stance.sentiments.length === 0) continue;
    parts.push(`${stance.sentiments.join("/")} on ${stance.issue.replace(/_/g, " ")}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "All voters";
}

export default async function CohortsPage() {
  const supabase = await createClient();

  const { data: cohorts } = await supabase
    .from("cohorts")
    .select("id, name, definition, created_at")
    .order("created_at", { ascending: false });

  const rows = cohorts ?? [];

  const evaluations = await Promise.all(
    rows.map((cohort) => evaluateCohort(supabase, (cohort.definition as CohortDefinition) ?? {})),
  );

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold text-navy">Cohort blocks</h1>
            <p className="text-sm text-slate">
              Standard pollster cohorts plus issue-defined blocks. Personal conversation evidence
              always trumps cohort inference in messaging.
            </p>
          </div>
          <Link
            href="/lab/cohorts/new"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover"
          >
            New cohort
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((cohort, i) => {
            const evaluation = evaluations[i];
            const total = LEVEL_ORDER.reduce(
              (sum, level) => sum + (evaluation.supportDistribution[level] ?? 0),
              0,
            );
            return (
              <div key={cohort.id} className="rounded-xl border border-rule bg-white p-5">
                <h2 className="mb-1 font-serif text-lg font-bold text-navy">{cohort.name}</h2>
                <p className="mb-3 text-sm text-slate">
                  {summarizeDefinition((cohort.definition as CohortDefinition) ?? {})}
                </p>
                <p className="mb-2 font-mono text-sm text-ink">
                  {evaluation.count.toLocaleString()} member{evaluation.count === 1 ? "" : "s"}
                </p>
                {evaluation.count === 0 ? (
                  <p className="text-sm text-slate">No members yet</p>
                ) : (
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-stone">
                    {LEVEL_ORDER.map((level) => {
                      const n = evaluation.supportDistribution[level] ?? 0;
                      const pct = total > 0 ? (n / total) * 100 : 0;
                      if (pct === 0) return null;
                      return (
                        <div
                          key={level}
                          style={{ width: `${pct}%`, backgroundColor: LEVEL_COLORS[level] }}
                          title={`${level.replace(/_/g, " ")}: ${n}`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="col-span-full rounded-xl border border-rule bg-white p-8 text-center text-sm text-slate">
              No cohorts yet — create one to see who's in it.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
