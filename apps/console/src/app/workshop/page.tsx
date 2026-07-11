import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import type { Role } from "@canvara/shared";
import { fetchSparkEffects } from "@canvara/shared";
import { QuestionGenerateForm, SparkGenerateForm } from "./generate-forms";
import { QuestionDraftActions } from "./draft-actions";
import { SparkDraftActions, SparkRetireAction } from "./spark-actions";

const APPROVER_ROLES: Role[] = ["admin", "manager", "field_director"];

const NEUTRALITY_FLAG_LABELS: Record<string, string> = {
  leading_wording: "leading wording",
  loaded_language: "loaded language",
  unbalanced_options: "unbalanced options",
  double_barreled: "double-barreled",
};

const ALIENATION_FLAG_LABELS: Record<string, string> = {
  alienation_risk: "alienation risk",
  partisan_tone: "partisan tone",
  overclaiming: "overclaiming",
  over_personalization: "over-personalization",
};

interface NeutralityGuardrailShape {
  leading_wording?: boolean;
  loaded_language?: boolean;
  unbalanced_options?: boolean;
  double_barreled?: boolean;
  suggested_fix?: string;
  reasoning?: string;
}

interface AlienationGuardrailShape {
  alienation_risk?: boolean;
  partisan_tone?: boolean;
  overclaiming?: boolean;
  over_personalization?: boolean;
  ceiling_note?: string;
  reasoning?: string;
}

function GuardrailBadge({ flagged }: { flagged: boolean }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
        flagged ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
      }`}
    >
      {flagged ? "guardrail: FLAG" : "guardrail: pass"}
    </span>
  );
}

function fmtNetMovement(pairs: number, netMovementPct: number | null, insufficientSample: boolean) {
  if (insufficientSample || netMovementPct === null) {
    return <span className="text-xs text-slate">n={pairs} — too few pairs</span>;
  }
  return (
    <span className="font-mono text-ink">
      {netMovementPct >= 0 ? "+" : "−"}
      {Math.abs(netMovementPct).toFixed(1)}%
    </span>
  );
}

export default async function WorkshopPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const canApprove = profile ? APPROVER_ROLES.includes(profile.role as Role) : false;

  const [{ data: cohorts }, { data: questionDrafts }, { data: sparkDrafts }, { data: approvedSparks }] =
    await Promise.all([
      supabase.from("cohorts").select("id, name").order("name", { ascending: true }),
      supabase
        .from("question_drafts")
        .select("id, question, options, rationale, guardrail, guardrail_verdict, created_at")
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("sparks")
        .select("id, title, opener, why, guardrail, guardrail_verdict, created_at, cohort_id")
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("sparks")
        .select("id, title, opener, why, created_at, cohort_id")
        .eq("status", "approved")
        .order("created_at", { ascending: false }),
    ]);

  const sparkEffects = await fetchSparkEffects(supabase);
  const effectsBySparkId = new Map(sparkEffects.map((e) => [e.sparkId, e]));
  const cohortNameById = new Map((cohorts ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="flex min-h-screen flex-col bg-stone">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 p-6">
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-bold text-navy">Voter Contact Workshop</h1>
          <p className="text-sm text-slate">
            Questions worth asking, openers worth trying — vetted before anyone knocks.
          </p>
          <p className="mt-1 text-xs text-slate">
            Drafts are grounded in your campaign narrative —{" "}
            <Link href="/narrative" className="underline-offset-2 hover:underline">
              edit it at Narrative
            </Link>
            .
          </p>
        </div>

        {/* ---------- Poll questions ---------- */}
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Poll questions</h2>
          <div className="mb-4">
            <QuestionGenerateForm />
          </div>

          <div className="space-y-4">
            {(questionDrafts ?? []).map((draft) => {
              const guardrail = (draft.guardrail ?? {}) as NeutralityGuardrailShape;
              const isFlagged = draft.guardrail_verdict === "flag";
              const flags = (
                ["leading_wording", "loaded_language", "unbalanced_options", "double_barreled"] as const
              ).filter((key) => guardrail[key] === true);

              return (
                <div key={draft.id} className="rounded-xl border border-rule bg-white p-5">
                  <h3 className="mb-2 font-serif text-lg font-bold text-navy">{draft.question}</h3>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {draft.options.map((opt: string, i: number) => (
                      <span
                        key={i}
                        className="rounded-md border border-rule bg-stone px-2 py-0.5 text-xs text-ink"
                      >
                        {opt}
                      </span>
                    ))}
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <GuardrailBadge flagged={isFlagged} />
                    {isFlagged &&
                      flags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700"
                        >
                          {NEUTRALITY_FLAG_LABELS[flag]}
                        </span>
                      ))}
                    <span className="text-xs text-slate">
                      {new Date(draft.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {draft.rationale && (
                    <p className="mb-2 text-sm text-slate italic">{draft.rationale}</p>
                  )}
                  {isFlagged && guardrail.reasoning && (
                    <p className="mb-1 text-sm text-red-700">{guardrail.reasoning}</p>
                  )}
                  {isFlagged && guardrail.suggested_fix && (
                    <p className="mb-2 text-sm text-slate">
                      Suggested fix: {guardrail.suggested_fix}
                    </p>
                  )}

                  {canApprove && (
                    <QuestionDraftActions
                      draftId={draft.id}
                      question={draft.question}
                      options={draft.options}
                      flagged={isFlagged}
                    />
                  )}
                </div>
              );
            })}

            {(questionDrafts ?? []).length === 0 && (
              <p className="text-sm text-slate">No draft questions yet — generate some above.</p>
            )}
          </div>
        </section>

        {/* ---------- Conversation sparks ---------- */}
        <section>
          <h2 className="mb-3 font-serif text-lg font-bold text-navy">Conversation sparks</h2>
          <div className="mb-4">
            <SparkGenerateForm cohorts={cohorts ?? []} />
          </div>

          <div className="mb-8 space-y-4">
            {(sparkDrafts ?? []).map((spark) => {
              const guardrail = (spark.guardrail ?? {}) as AlienationGuardrailShape;
              const isFlagged = spark.guardrail_verdict === "flag";
              const flags = (
                ["alienation_risk", "partisan_tone", "overclaiming", "over_personalization"] as const
              ).filter((key) => guardrail[key] === true);

              return (
                <div key={spark.id} className="rounded-xl border border-rule bg-white p-5">
                  <h3 className="mb-2 font-serif text-lg font-bold text-navy">{spark.title}</h3>
                  <p className="mb-2 leading-relaxed text-ink">&ldquo;{spark.opener}&rdquo;</p>
                  {spark.why && <p className="mb-3 text-sm text-slate">{spark.why}</p>}

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <GuardrailBadge flagged={isFlagged} />
                    {isFlagged &&
                      flags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700"
                        >
                          {ALIENATION_FLAG_LABELS[flag]}
                        </span>
                      ))}
                    <span className="text-xs text-slate">
                      {(spark.cohort_id && cohortNameById.get(spark.cohort_id)) ?? "Campaign-wide"}
                    </span>
                    <span className="text-xs text-slate">
                      {new Date(spark.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {isFlagged && guardrail.reasoning && (
                    <p className="mb-2 text-sm text-red-700">{guardrail.reasoning}</p>
                  )}

                  {canApprove && <SparkDraftActions sparkId={spark.id} />}
                </div>
              );
            })}

            {(sparkDrafts ?? []).length === 0 && (
              <p className="text-sm text-slate">No draft sparks yet — generate some above.</p>
            )}
          </div>

          <h3 className="mb-1 font-serif text-lg font-bold text-navy">Approved sparks</h3>
          <p className="mb-3 text-xs text-slate">
            Movement = pre/post cold-test pairs in conversations where this spark was used.
          </p>
          <div className="space-y-4">
            {(approvedSparks ?? []).map((spark) => {
              const effect = effectsBySparkId.get(spark.id);
              return (
                <div key={spark.id} className="rounded-xl border border-rule bg-white p-5">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-serif text-lg font-bold text-navy">{spark.title}</h4>
                      <p className="text-sm text-ink">&ldquo;{spark.opener}&rdquo;</p>
                    </div>
                    <SparkRetireAction sparkId={spark.id} />
                  </div>
                  {spark.why && <p className="mb-2 text-sm text-slate">{spark.why}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate">
                    <span>
                      {(spark.cohort_id && cohortNameById.get(spark.cohort_id)) ?? "Campaign-wide"}
                    </span>
                    {effect && (
                      <>
                        <span>usages: {effect.usages}</span>
                        <span>pairs: {effect.pairs}</span>
                        <span>
                          net movement:{" "}
                          {fmtNetMovement(effect.pairs, effect.netMovementPct, effect.insufficientSample)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {(approvedSparks ?? []).length === 0 && (
              <p className="text-sm text-slate">No approved sparks yet.</p>
            )}
          </div>

          <p className="mt-3 text-xs text-slate">
            Approved sparks appear on canvassers&apos; door cards at next sync.
          </p>
        </section>
      </main>
    </div>
  );
}
