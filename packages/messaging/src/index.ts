// Message Lab v1 (CC-5, ADR-8): Sonnet 4.6 drafts against evidence,
// Fable 5 guardrails every draft before a human sees it. Used by the
// console's server actions and the M7 exit test — never by clients
// directly (this package holds API-key-bearing calls).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DbClient, Json } from "@canvara/db";
import {
  evaluateCohort,
  fetchIssueSalience,
  fetchPersuasionProfile,
  type CohortDefinition,
} from "@canvara/shared";
import {
  messageCohortPrompt,
  messageIndividualPrompt,
  guardrailPrompt,
} from "@canvara/prompts";

export * from "./workshop";

let _client: Anthropic | null = null;
function client(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

// ---------- Schemas ----------

const DraftSchema = z.object({
  variants: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
    }),
  ),
  rationale: z.string(),
});

export const GuardrailSchema = z.object({
  alienation_risk: z.boolean(),
  partisan_tone: z.boolean(),
  overclaiming: z.boolean(),
  over_personalization: z.boolean(),
  ceiling_note: z.string(),
  reasoning: z.string(),
  verdict: z.enum(["pass", "flag"]),
});
export type GuardrailResult = z.infer<typeof GuardrailSchema>;

export type MessageGoal = "persuade" | "turnout" | "introduce";

// ---------- Guardrail (Fable 5 with Opus fallback, per ADR-8) ----------

export async function runGuardrail(
  draft: { title: string; body: string },
  targetEvidence: string,
  goal: MessageGoal,
): Promise<GuardrailResult> {
  const response = await client().beta.messages.create({
    model: guardrailPrompt.model, // claude-fable-5
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: guardrailPrompt.text,
    output_config: { format: zodOutputFormat(GuardrailSchema) },
    messages: [
      {
        role: "user",
        content:
          `<goal>${goal}</goal>\n\n<target_evidence>\n${targetEvidence}\n</target_evidence>\n\n` +
          `<draft>\nTitle: ${draft.title}\n\n${draft.body}\n</draft>\n\nRun the guardrail check.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return {
      alienation_risk: true,
      partisan_tone: false,
      overclaiming: false,
      over_personalization: false,
      ceiling_note: "",
      reasoning: "Guardrail model declined to evaluate — flagged for human review.",
      verdict: "flag",
    };
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("guardrail returned no text content");
  }
  return GuardrailSchema.parse(JSON.parse(text.text));
}

// ---------- Drafting (Sonnet 4.6) ----------

async function draftVariants(
  system: string,
  input: string,
): Promise<z.infer<typeof DraftSchema>> {
  const response = await client().messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: zodOutputFormat(DraftSchema) },
    messages: [{ role: "user", content: input }],
  });
  if (!response.parsed_output) {
    throw new Error("message drafting returned no parseable output");
  }
  return response.parsed_output;
}

export interface GeneratedMessage {
  id: string;
  title: string;
  body: string;
  guardrail: GuardrailResult;
}

interface CommonOpts {
  campaignId: string;
  actorId: string;
  goal: MessageGoal;
  issue?: string;
}

async function persistDrafts(
  db: DbClient,
  opts: CommonOpts & {
    kind: "cohort" | "individual";
    cohortId?: string;
    voterId?: string;
    promptVersion: string;
  },
  drafts: z.infer<typeof DraftSchema>,
  evidence: unknown,
  evidenceText: string,
): Promise<GeneratedMessage[]> {
  const out: GeneratedMessage[] = [];
  for (const variant of drafts.variants) {
    const guardrail = await runGuardrail(variant, evidenceText, opts.goal);
    const { data, error } = await db
      .from("messages")
      .insert({
        campaign_id: opts.campaignId,
        kind: opts.kind,
        cohort_id: opts.cohortId ?? null,
        voter_id: opts.voterId ?? null,
        issue_id: opts.issue ?? null,
        goal: opts.goal,
        title: variant.title,
        body: variant.body,
        rationale: drafts.rationale,
        evidence: evidence as Json,
        guardrail: guardrail as unknown as Json,
        guardrail_verdict: guardrail.verdict,
        model_used: "claude-sonnet-4-6",
        prompt_version: opts.promptVersion,
        created_by: opts.actorId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`persist message: ${error.message}`);
    out.push({ id: data.id, ...variant, guardrail });
  }
  return out;
}

/** Cohort message: grounded in the block's evidence (CC-5 generic tier). */
export async function generateCohortMessages(
  db: DbClient,
  opts: CommonOpts & { cohortId: string },
): Promise<GeneratedMessage[]> {
  const { data: cohort, error } = await db
    .from("cohorts")
    .select("id, name, definition")
    .eq("id", opts.cohortId)
    .single();
  if (error || !cohort) throw new Error(`cohort: ${error?.message ?? "not found"}`);

  const [evaluation, salience] = await Promise.all([
    evaluateCohort(db, cohort.definition as unknown as CohortDefinition),
    fetchIssueSalience(db),
  ]);

  const evidence = {
    cohort: { name: cohort.name, definition: cohort.definition },
    members: evaluation.count,
    support_distribution: evaluation.supportDistribution,
    issue_salience: salience.slice(0, 8),
    focus_issue: opts.issue ?? null,
  };
  const evidenceText = JSON.stringify(evidence, null, 2);

  const drafts = await draftVariants(
    messageCohortPrompt.text,
    `<evidence>\n${evidenceText}\n</evidence>\n\nGoal: ${opts.goal}` +
      (opts.issue ? `\nFocus issue: ${opts.issue}` : "") +
      `\n\nDraft the variants.`,
  );

  return persistDrafts(
    db,
    { ...opts, kind: "cohort", cohortId: opts.cohortId, promptVersion: messageCohortPrompt.version },
    drafts,
    evidence,
    evidenceText,
  );
}

/**
 * Individual message: tailored from the persuasion profile. Personal
 * evidence always trumps cohort inference (enforced again by the guardrail).
 */
export async function generateIndividualMessages(
  db: DbClient,
  opts: CommonOpts & { voterId: string },
): Promise<GeneratedMessage[]> {
  const [profile, voterRes] = await Promise.all([
    fetchPersuasionProfile(db, opts.voterId),
    db.from("voters").select("first_name, last_name, party").eq("id", opts.voterId).single(),
  ]);
  if (voterRes.error) throw new Error(`voter: ${voterRes.error.message}`);

  const evidence = {
    voter: {
      name: `${voterRes.data.first_name ?? ""} ${voterRes.data.last_name ?? ""}`.trim(),
      party: voterRes.data.party,
    },
    personal_context: profile.personalContext,
    observed_attributes: profile.observedAttributes,
    beliefs: profile.beliefs.slice(0, 5),
    issue_sentiment: profile.issueSentiment,
    resonance_history: profile.resonanceHistory.slice(0, 8),
    precedence: profile.precedence,
    focus_issue: opts.issue ?? null,
  };
  const evidenceText = JSON.stringify(evidence, null, 2);

  const drafts = await draftVariants(
    messageIndividualPrompt.text,
    `<persuasion_profile>\n${evidenceText}\n</persuasion_profile>\n\nGoal: ${opts.goal}` +
      (opts.issue ? `\nFocus issue: ${opts.issue}` : "") +
      `\n\nDraft the variants.`,
  );

  return persistDrafts(
    db,
    {
      ...opts,
      kind: "individual",
      voterId: opts.voterId,
      promptVersion: messageIndividualPrompt.version,
    },
    drafts,
    evidence,
    evidenceText,
  );
}
