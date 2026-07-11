// M7 exit test: Message Lab v1 (CC-5).
//  - individual messages draft from the persuasion profile (evidence
//    stored with the message), guardrail-checked
//  - THE test: a deliberately alienating draft — immigration-restriction
//    framing aimed at the voter whose profile shows a mission in Chile and
//    years of pro-immigrant community work — must be FLAGGED with
//    alienation_risk by the Fable guardrail
//  - cohort messages ground in the block's evidence (member counts)
//  - approval is leadership-only (RLS); campaign B sees nothing
//
// Prereq: `npm run test:m65` (voter E's profile) in this database state.

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type Json,
} from "@canvara/db";
import { fetchPersuasionProfile } from "@canvara/shared";
import {
  generateIndividualMessages,
  generateCohortMessages,
  runGuardrail,
} from "@canvara/messaging";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
for (const key of ["ANTHROPIC_API_KEY"] as const) {
  if (!process.env[key]) throw new Error(`${key} missing from .env.`);
}
const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let manager: DbClient;
let managerId: string;
let canvasser: DbClient;
let clientB: DbClient;
let voterE: string; // the Chile-mission voter from the M6.5 seed
let cohortId: string;
let draftMessageId: string;

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;

  const { data: voter } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .eq("external_id", "M65-E")
    .maybeSingle();
  if (!voter) throw new Error("Voter M65-E not found — run `npm run test:m65` first.");
  voterE = voter.id;

  // Idempotent teardown of prior M7 artifacts.
  await service.from("messages").delete().eq("campaign_id", campaignA);
  await service.from("cohorts").delete().eq("campaign_id", campaignA).like("name", "M7 %");

  manager = await signIn(USER_A.email, USER_A.password);
  const { data: mu } = await manager.auth.getUser();
  managerId = mu.user!.id;
  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);

  const { data: cohort, error } = await manager
    .from("cohorts")
    .insert({
      campaign_id: campaignA,
      name: "M7 Tax-angry college grads",
      definition: {
        demographics: { education: ["college"] },
        issue_stances: [{ issue: "property_taxes", sentiments: ["negative"] }],
      } as unknown as Json,
      created_by: managerId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cohort seed: ${error.message}`);
  cohortId = cohort.id;
});

test("individual message: drafted from personal evidence, guardrailed, stored", async () => {
  const generated = await generateIndividualMessages(manager, {
    campaignId: campaignA,
    actorId: managerId,
    voterId: voterE,
    goal: "persuade",
  });
  assert.ok(generated.length >= 2, "multiple variants drafted");
  draftMessageId = generated[0].id;

  for (const message of generated) {
    assert.ok(message.body.split(/\s+/).length >= 20, "substantive body");
    assert.ok(message.guardrail.verdict === "pass" || message.guardrail.verdict === "flag");
    assert.ok(message.guardrail.ceiling_note.length > 0, "ceiling note present");
  }
  assert.ok(
    generated.some((m) => m.guardrail.verdict === "pass"),
    "at least one variant clears the guardrail",
  );

  const { data: row } = await service
    .from("messages")
    .select("kind, status, prompt_version, evidence, guardrail_verdict")
    .eq("id", draftMessageId)
    .single();
  assert.equal(row!.kind, "individual");
  assert.equal(row!.status, "draft");
  assert.equal(row!.prompt_version, "message-individual.v2");
  const evidence = row!.evidence as { personal_context: string[]; precedence: string };
  assert.ok(evidence.personal_context.length >= 2, "message stores the evidence that shaped it");
  assert.equal(evidence.precedence, "individual_over_cohort");
});

test("guardrail flags an alienating cohort-stereotype message for this voter", async () => {
  const profile = await fetchPersuasionProfile(manager, voterE);
  const evidenceText = JSON.stringify(
    {
      personal_context: profile.personalContext,
      observed_attributes: profile.observedAttributes,
      issue_sentiment: profile.issueSentiment,
      precedence: profile.precedence,
    },
    null,
    2,
  );

  // What a cohort-only pipeline might send a 50s white Republican male —
  // and exactly what must never reach THIS voter.
  const badDraft = {
    title: "Tough on the border",
    body:
      "Illegal immigration is out of control and it's draining our county. " +
      "Rivera will shut down the county's so-called legal aid handouts, crack down " +
      "on those who don't belong here, and guarantee your taxes stop paying for them. " +
      "People like you know exactly who's to blame.",
  };

  const result = await runGuardrail(badDraft, evidenceText, "persuade");
  assert.equal(result.verdict, "flag", "the guardrail flags the message");
  assert.equal(
    result.alienation_risk,
    true,
    "alienation risk detected — cohort stereotype contradicts personal evidence",
  );
  assert.ok(result.reasoning.length > 20, "reasoning is concrete");
});

test("cohort message: grounded in the block's evidence", async () => {
  const generated = await generateCohortMessages(manager, {
    campaignId: campaignA,
    actorId: managerId,
    cohortId,
    goal: "persuade",
    issue: "property_taxes",
  });
  assert.ok(generated.length >= 2, "multiple variants drafted");

  const { data: row } = await service
    .from("messages")
    .select("kind, evidence, prompt_version")
    .eq("id", generated[0].id)
    .single();
  assert.equal(row!.kind, "cohort");
  assert.equal(row!.prompt_version, "message-cohort.v2");
  const evidence = row!.evidence as { members: number; cohort: { name: string } };
  assert.equal(evidence.members, 3, "evidence carries the evaluated member count (A, B, E)");
  assert.equal(evidence.cohort.name, "M7 Tax-angry college grads");
});

test("approval is leadership-only under RLS", async () => {
  const { data: denied, error: deniedErr } = await canvasser
    .from("messages")
    .update({ status: "approved", approved_by: null })
    .eq("id", draftMessageId)
    .select("id");
  assert.ifError(deniedErr);
  assert.equal(denied!.length, 0, "canvasser cannot approve");

  const { data: approved, error: approvedErr } = await manager
    .from("messages")
    .update({
      status: "approved",
      approved_by: managerId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", draftMessageId)
    .select("id, status");
  assert.ifError(approvedErr);
  assert.equal(approved!.length, 1);
  assert.equal(approved![0].status, "approved");
});

test("isolation: campaign B sees no messages", async () => {
  const { data } = await clientB.from("messages").select("id");
  assert.equal(data!.length, 0);
});
