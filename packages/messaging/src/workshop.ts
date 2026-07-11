// Voter Contact Workshop (M12): Sonnet drafts poll questions and
// conversation sparks against campaign evidence; Fable guardrails every
// draft before a human reviews it. Poll questions get the NEUTRALITY
// rubric (a leading question poisons every downstream number); sparks
// get the alienation rubric shared with Message Lab. Server-only.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DbClient, Json } from "@canvara/db";
import {
  evaluateCohort,
  fetchIssueSalience,
  fetchCampaignNarrative,
  formatNarrativeForPrompt,
  type CohortDefinition,
} from "@canvara/shared";
import {
  pollQuestionsPrompt,
  sparksPrompt,
  neutralityGuardrailPrompt,
} from "@canvara/prompts";
import { runGuardrail, type GuardrailResult } from "./index";

let _client: Anthropic | null = null;
function client(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

// ---------- Schemas ----------

const QuestionDraftsSchema = z.object({
  variants: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
    }),
  ),
  rationale: z.string(),
});

const SparkDraftsSchema = z.object({
  variants: z.array(
    z.object({
      title: z.string(),
      body: z.string(), // the opener, optionally with a "Why:" line
    }),
  ),
  rationale: z.string(),
});

export const NeutralityGuardrailSchema = z.object({
  leading_wording: z.boolean(),
  loaded_language: z.boolean(),
  unbalanced_options: z.boolean(),
  double_barreled: z.boolean(),
  suggested_fix: z.string(),
  reasoning: z.string(),
  verdict: z.enum(["pass", "flag"]),
});
export type NeutralityGuardrailResult = z.infer<typeof NeutralityGuardrailSchema>;

// ---------- Neutrality guardrail (Fable 5 with Opus fallback) ----------

export async function runNeutralityGuardrail(question: {
  question: string;
  options: string[];
}): Promise<NeutralityGuardrailResult> {
  const response = await client().beta.messages.create({
    model: neutralityGuardrailPrompt.model, // claude-fable-5
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: neutralityGuardrailPrompt.text,
    output_config: { format: zodOutputFormat(NeutralityGuardrailSchema) },
    messages: [
      {
        role: "user",
        content:
          `<question>${question.question}</question>\n` +
          `<options>${question.options.join(" | ")}</options>\n\n` +
          `Run the neutrality check.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return {
      leading_wording: true,
      loaded_language: false,
      unbalanced_options: false,
      double_barreled: false,
      suggested_fix: "",
      reasoning: "Guardrail model declined to evaluate — flagged for human review.",
      verdict: "flag",
    };
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("neutrality guardrail returned no text content");
  }
  return NeutralityGuardrailSchema.parse(JSON.parse(text.text));
}

// ---------- Drafting (Sonnet 4.6) ----------

async function draft<T>(
  system: string,
  input: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await client().messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: input }],
  });
  if (!response.parsed_output) {
    throw new Error("workshop drafting returned no parseable output");
  }
  return response.parsed_output;
}

export interface GeneratedQuestionDraft {
  id: string;
  question: string;
  options: string[];
  guardrail: NeutralityGuardrailResult;
}

/**
 * Draft door-poll questions grounded in the campaign's live evidence,
 * neutrality-guardrail each, and persist for leadership review. Approval
 * (a console action) copies a draft into survey_questions.
 */
export async function generatePollQuestions(
  db: DbClient,
  opts: { campaignId: string; actorId: string; focus?: string },
): Promise<GeneratedQuestionDraft[]> {
  const [salience, existingRes] = await Promise.all([
    fetchIssueSalience(db),
    db.from("survey_questions").select("question").eq("active", true),
  ]);
  if (existingRes.error) throw new Error(`existing questions: ${existingRes.error.message}`);

  const evidence = {
    issue_salience: salience.slice(0, 8),
    existing_questions: (existingRes.data ?? []).map((q) => q.question),
    focus: opts.focus ?? null,
  };
  const evidenceText = JSON.stringify(evidence, null, 2);

  const drafts = await draft(
    pollQuestionsPrompt.text,
    `<evidence>\n${evidenceText}\n</evidence>\n` +
      (opts.focus ? `\nThe campaign wants questions about: ${opts.focus}` : "") +
      `\n\nDraft the variants.`,
    QuestionDraftsSchema,
  );

  const out: GeneratedQuestionDraft[] = [];
  for (const variant of drafts.variants) {
    const guardrail = await runNeutralityGuardrail(variant);
    const { data, error } = await db
      .from("question_drafts")
      .insert({
        campaign_id: opts.campaignId,
        question: variant.question,
        options: variant.options,
        rationale: drafts.rationale,
        evidence: evidence as unknown as Json,
        guardrail: guardrail as unknown as Json,
        guardrail_verdict: guardrail.verdict,
        model_used: "claude-sonnet-4-6",
        prompt_version: pollQuestionsPrompt.version,
        created_by: opts.actorId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`persist question draft: ${error.message}`);
    out.push({ id: data.id, ...variant, guardrail });
  }
  return out;
}

export interface GeneratedSpark {
  id: string;
  title: string;
  opener: string;
  why: string | null;
  guardrail: GuardrailResult;
}

/**
 * Draft conversation sparks — connection-first openers — for a cohort
 * (or campaign-wide when no cohort is given). Each spark runs the
 * alienation guardrail before leadership review; only approved sparks
 * ever reach a canvasser's briefing card.
 */
export async function generateSparks(
  db: DbClient,
  opts: { campaignId: string; actorId: string; cohortId?: string },
): Promise<GeneratedSpark[]> {
  let cohortEvidence: unknown = null;
  let cohortName: string | null = null;
  if (opts.cohortId) {
    const { data: cohort, error } = await db
      .from("cohorts")
      .select("id, name, definition")
      .eq("id", opts.cohortId)
      .single();
    if (error || !cohort) throw new Error(`cohort: ${error?.message ?? "not found"}`);
    const evaluation = await evaluateCohort(db, cohort.definition as unknown as CohortDefinition);
    cohortName = cohort.name;
    cohortEvidence = {
      name: cohort.name,
      definition: cohort.definition,
      members: evaluation.count,
      support_distribution: evaluation.supportDistribution,
    };
  }
  const [salience, narrative] = await Promise.all([
    fetchIssueSalience(db),
    fetchCampaignNarrative(db, opts.campaignId),
  ]);

  const evidence = {
    cohort: cohortEvidence,
    issue_salience: salience.slice(0, 8),
    narrative: narrative ?? null,
  };
  const evidenceText = JSON.stringify(evidence, null, 2);

  const narrativeText = formatNarrativeForPrompt(narrative);
  const drafts = await draft(
    sparksPrompt.text,
    (narrativeText ? `<campaign_narrative>\n${narrativeText}\n</campaign_narrative>\n\n` : "") +
      `<evidence>\n${evidenceText}\n</evidence>\n` +
      (cohortName
        ? `\nThese sparks are for canvassers talking with the "${cohortName}" cohort.`
        : `\nThese sparks are campaign-wide (any voter at any door).`) +
      `\n\nDraft the sparks.`,
    SparkDraftsSchema,
  );

  const out: GeneratedSpark[] = [];
  for (const variant of drafts.variants) {
    // Reuse Message Lab's alienation rubric — a spark is voter-facing
    // language grounded in cohort evidence, exactly what it vets.
    const guardrail = await runGuardrail(
      { title: variant.title, body: variant.body },
      evidenceText,
      "introduce",
    );
    const [opener, ...rest] = variant.body.split(/\nWhy:\s*/i);
    const { data, error } = await db
      .from("sparks")
      .insert({
        campaign_id: opts.campaignId,
        cohort_id: opts.cohortId ?? null,
        title: variant.title,
        opener: opener.trim(),
        why: rest.length > 0 ? rest.join(" ").trim() : null,
        evidence: evidence as unknown as Json,
        guardrail: guardrail as unknown as Json,
        guardrail_verdict: guardrail.verdict,
        model_used: "claude-sonnet-4-6",
        prompt_version: sparksPrompt.version,
        created_by: opts.actorId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`persist spark: ${error.message}`);
    out.push({
      id: data.id,
      title: variant.title,
      opener: opener.trim(),
      why: rest.length > 0 ? rest.join(" ").trim() : null,
      guardrail,
    });
  }
  return out;
}
