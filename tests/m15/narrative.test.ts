// M15 exit test: the campaign narrative — the candidate's persona woven
// into generation.
//  - formatNarrativeForPrompt renders deterministically
//  - authoring the narrative is leadership-only (RLS); members can read
//  - a cohort message generated WITH a distinctive narrative echoes it,
//    and stores the narrative snapshot in its evidence + bumped version
//  - campaign B sees no narrative
//
// Makes one real Sonnet + Fable call (like M7). Run after m0/m1.

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
import { formatNarrativeForPrompt, narrativeHasContent } from "@canvara/shared";
import { generateCohortMessages } from "@canvara/messaging";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

// A deliberately distinctive persona — a message that used it will echo
// one of these unmistakable tokens.
const NARRATIVE = {
  candidate_name: "Nick Willis",
  pitch: "The plumber who's fixing this town's pipes — and its politics.",
  story:
    "Nick Willis is a third-generation plumber who has spent thirty years keeping this town's water running while City Hall let the pipes rot.",
  values: ["hard work", "straight talk", "clean water"],
  signature_issues: ["water infrastructure", "property taxes"],
  proof_points: [
    "third-generation plumber",
    "thirty years fixing this town's pipes",
    "grew up on the east side",
  ],
  tone: "plainspoken, blue-collar, no-nonsense",
};
const ECHO_TOKENS = ["willis", "plumb", "pipe", "water"];
const COHORT_NAME = "M15 Independents";

let campaignA: string;
let manager: DbClient;
let managerId: string;
let canvasser: DbClient;
let clientB: DbClient;
let cohortId: string;

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

before(async () => {
  const { data: camp } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!camp) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = camp.id;
  await ensureCanvasser(service, campaignA);

  // Teardown.
  await service.from("campaign_narrative").delete().eq("campaign_id", campaignA);
  await service.from("messages").delete().eq("campaign_id", campaignA).like("title", "%");
  await service.from("cohorts").delete().eq("campaign_id", campaignA).eq("name", COHORT_NAME);

  const { data: cohort, error } = await service
    .from("cohorts")
    .insert({
      campaign_id: campaignA,
      name: COHORT_NAME,
      definition: { demographics: { party: ["independent"] } } as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cohort seed: ${error.message}`);
  cohortId = cohort.id;

  manager = await signIn(USER_A.email, USER_A.password);
  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
  const {
    data: { user },
  } = await manager.auth.getUser();
  managerId = user!.id;
});

// ---------- Pure formatting ----------

test("formatNarrativeForPrompt renders every field deterministically", () => {
  const text = formatNarrativeForPrompt({
    candidateName: "Nick Willis",
    pitch: "The plumber for the job.",
    story: "Thirty years of pipes.",
    values: ["hard work", "clean water"],
    signatureIssues: ["water"],
    proofPoints: ["third-generation plumber"],
    tone: "plainspoken",
  });
  assert.match(text, /Candidate: Nick Willis/);
  assert.match(text, /Pitch: The plumber for the job\./);
  assert.match(text, /Core values: hard work; clean water/);
  assert.match(text, /Proof points: third-generation plumber/);
  assert.match(text, /Voice \/ tone: plainspoken/);

  // Empty / null narrative yields no block (callers skip it cleanly).
  assert.equal(formatNarrativeForPrompt(null), "");
  assert.equal(
    formatNarrativeForPrompt({
      candidateName: null,
      pitch: null,
      story: null,
      values: [],
      signatureIssues: [],
      proofPoints: [],
      tone: null,
    }),
    "",
  );
  assert.equal(narrativeHasContent(null), false);
});

// ---------- Authoring is leadership-only ----------

test("authoring the narrative is leadership-only; members can read", async () => {
  // A canvasser cannot write it.
  const { error: cErr } = await canvasser.from("campaign_narrative").insert({
    campaign_id: campaignA,
    candidate_name: "Impostor",
  });
  assert.ok(cErr, "canvasser blocked from authoring the narrative");

  // The manager can.
  const { error: mErr } = await manager.from("campaign_narrative").upsert(
    { campaign_id: campaignA, ...NARRATIVE, updated_by: managerId },
    { onConflict: "campaign_id" },
  );
  assert.ifError(mErr);

  // A canvasser CAN read it (it grounds their work).
  const { data: read } = await canvasser
    .from("campaign_narrative")
    .select("candidate_name")
    .eq("campaign_id", campaignA)
    .single();
  assert.equal(read!.candidate_name, "Nick Willis");
});

// ---------- The narrative shapes generation ----------

test("a cohort message is generated in the candidate's voice and stores the narrative", async () => {
  const messages = await generateCohortMessages(manager, {
    campaignId: campaignA,
    actorId: managerId,
    cohortId,
    goal: "persuade",
  });
  assert.ok(messages.length >= 2, "variants drafted");

  // The narrative snapshot rides along in the stored evidence + v2 prompt.
  const { data: row } = await service
    .from("messages")
    .select("evidence, prompt_version")
    .eq("id", messages[0].id)
    .single();
  assert.equal(row!.prompt_version, "message-cohort.v2");
  const evidence = row!.evidence as { narrative: { candidate_name?: string } | null };
  assert.ok(evidence.narrative, "narrative snapshot stored on the message");

  // The output actually reflects the persona — at least one variant's body
  // or rationale echoes a distinctive narrative token. (LLM output: if this
  // ever flickers, re-run once, like the M7 guardrail check.)
  const haystack = messages
    .map((m) => `${m.title} ${m.body}`)
    .join(" ")
    .toLowerCase();
  assert.ok(
    ECHO_TOKENS.some((t) => haystack.includes(t)),
    `expected the message to echo the Nick-Willis-the-plumber narrative; got: ${haystack.slice(0, 300)}`,
  );
});

// ---------- Isolation ----------

test("campaign B sees no narrative for campaign A", async () => {
  const { data } = await clientB
    .from("campaign_narrative")
    .select("id")
    .eq("campaign_id", campaignA);
  assert.equal(data!.length, 0);
});
