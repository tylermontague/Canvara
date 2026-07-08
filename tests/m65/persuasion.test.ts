// M6.5 exit test: persuasion foundations.
//  - import lib maps the new demographic columns
//  - cohort evaluation: exact counts for demographic, issue-stance, and
//    combined cohorts on a dedicated seed; door-observed attributes TRUMP
//    the voter file (the precedence principle)
//  - personal_context: extracted from a conversation (prompt v3) and
//    SURVIVES a retention purge of the transcript
//  - door polls: answers queued offline sync idempotently
//  - RLS: canvasser can write observed attributes; campaign B sees nothing

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type Json,
} from "@canvara/db";
import {
  suggestMapping,
  evaluateCohort,
  fetchPersuasionProfile,
  createMemoryQueueStore,
  syncQueue,
  type QueuedCapture,
  type SyncPorts,
} from "@canvara/shared";
import { processAvailable } from "@canvara/worker/pipeline";
import { runRetentionSweep } from "@canvara/worker/retention";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);
const deepgramKey = process.env.DEEPGRAM_API_KEY ?? "";

const MARK = "M65-";

let campaignA: string;
let canvasserId: string;
let canvasser: DbClient;
let manager: DbClient;
let clientB: DbClient;
// Seeded voters A..F by external id.
const voterIds: Record<string, string> = {};
let contextConvoId: string;
let contextSignalId: string;

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

async function seedSignal(
  voterId: string,
  recordedAt: string,
  support: string,
  sentiment: Record<string, string>,
): Promise<string> {
  const convoId = randomUUID();
  await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    recorded_at: recordedAt,
    status: "extracted",
  });
  const { error } = await service.from("signals").insert({
    campaign_id: campaignA,
    conversation_id: convoId,
    support_level: support,
    top_issues: Object.keys(sentiment),
    issue_sentiment: sentiment as unknown as Json,
    confidence_score: 0.9,
    model_used: "m65-seed",
    prompt_version: "m65-seed",
  });
  if (error) throw new Error(`seed signal: ${error.message}`);
  return convoId;
}

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;
  canvasserId = await ensureCanvasser(service, campaignA);

  // Teardown previous M6.5 artifacts.
  const { data: oldVoters } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", `${MARK}%`);
  const oldIds = (oldVoters ?? []).map((v) => v.id);
  if (oldIds.length > 0) {
    const { data: oldConvos } = await service
      .from("conversations")
      .select("id")
      .in("voter_id", oldIds);
    const convoIds = (oldConvos ?? []).map((c) => c.id);
    if (convoIds.length > 0) {
      await service.from("survey_responses").delete().in("conversation_id", convoIds);
      await service.from("review_queue").delete().in("conversation_id", convoIds);
      await service.from("conversations").delete().in("id", convoIds);
    }
    await service.from("belief_states").delete().in("voter_id", oldIds);
    // Message Lab drafts (M7) reference voters — clear them first.
    await service.from("messages").delete().in("voter_id", oldIds);
    const { error: voterErr } = await service.from("voters").delete().in("id", oldIds);
    if (voterErr) throw new Error(`teardown M65 voters: ${voterErr.message}`);
  }
  await service.from("survey_questions").delete().eq("campaign_id", campaignA).like("question", "M65%");
  await service.from("cohorts").delete().eq("campaign_id", campaignA).like("name", "M65%");

  // Six dedicated voters. Education 'college' fences these cohorts off from
  // M1/M5 voters (whose education is null).
  const seed = [
    { key: "A", gender: "F", birth_year: 1975, race: "white", education: "college" },
    { key: "B", gender: "F", birth_year: 1990, race: "white", education: "college" },
    { key: "C", gender: "M", birth_year: 1960, race: "white", education: "college" },
    { key: "D", gender: "F", birth_year: 1970, race: "white", education: "college" },
    { key: "E", gender: "M", birth_year: 1980, race: "white", education: "college" },
    { key: "F", gender: "F", birth_year: 1968, race: "white", education: "college" },
  ];
  for (const v of seed) {
    const { data, error } = await service
      .from("voters")
      .insert({
        campaign_id: campaignA,
        external_id: `${MARK}${v.key}`,
        first_name: v.key,
        last_name: "PersuasionTest",
        gender: v.gender,
        birth_year: v.birth_year,
        race: v.race,
        education: v.education,
        city: "Testville",
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed voter ${v.key}: ${error.message}`);
    voterIds[v.key] = data.id;
  }

  // Signals (latest matters): A/B/E negative on property_taxes, C positive,
  // F negative-then-positive (latest wins), D none.
  const T1 = "2026-07-01T12:00:00Z";
  const T2 = "2026-07-03T12:00:00Z";
  await seedSignal(voterIds["A"], T1, "undecided", { property_taxes: "negative" });
  await seedSignal(voterIds["B"], T1, "lean_oppose", { property_taxes: "negative" });
  await seedSignal(voterIds["C"], T1, "strong_support", { property_taxes: "positive" });
  await seedSignal(voterIds["E"], T1, "lean_support", { property_taxes: "negative" });
  await seedSignal(voterIds["F"], T1, "undecided", { property_taxes: "negative" });
  await seedSignal(voterIds["F"], T2, "lean_support", { property_taxes: "positive" });

  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  manager = await signIn(USER_A.email, USER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
});

test("import lib maps the new demographic columns", () => {
  const header = [
    "Voter ID", "Last Name", "First Name", "Gender", "Birth Year", "Party",
    "Race", "Household Income", "Education Level", "Religion",
    "Street Address", "City", "Zip",
  ];
  const mapping = suggestMapping(header);
  assert.deepEqual(mapping.race, [6]);
  assert.deepEqual(mapping.income_bracket, [7]);
  assert.deepEqual(mapping.education, [8]);
  assert.deepEqual(mapping.religion, [9]);
});

test("cohorts: demographic, issue-stance, and combined counts are exact", async () => {
  // Women 45–64 with a college education → A (51), D (56), F (58).
  const women4564 = await evaluateCohort(manager, {
    demographics: { gender: ["female"], age_bracket: ["45_64"], education: ["college"] },
  });
  assert.equal(women4564.count, 3, "women 45–64: A, D, F");

  // Negative on property taxes (latest signal), college-fenced →
  // A, B, E — not F (latest flipped positive), not C (positive), not D.
  const taxAngry = await evaluateCohort(manager, {
    demographics: { education: ["college"] },
    issue_stances: [{ issue: "property_taxes", sentiments: ["negative"] }],
  });
  assert.equal(taxAngry.count, 3, "tax-negative: A, B, E");
  assert.deepEqual(
    taxAngry.supportDistribution,
    { undecided: 1, lean_oppose: 1, lean_support: 1 },
    "cohort support from each member's latest signal",
  );

  // Combined: women 45–64 AND tax-negative → A only.
  const combined = await evaluateCohort(manager, {
    demographics: { gender: ["female"], age_bracket: ["45_64"], education: ["college"] },
    issue_stances: [{ issue: "property_taxes", sentiments: ["negative"] }],
  });
  assert.equal(combined.count, 1, "intersection: A only");
  assert.deepEqual(combined.voterIds, [voterIds["A"]]);
});

test("door-observed attributes trump the voter file in cohorts (RLS write path)", async () => {
  // The file says E is white; the canvasser learned he's Hispanic.
  const { error } = await canvasser.from("voter_attributes").upsert(
    {
      campaign_id: campaignA,
      voter_id: voterIds["E"],
      key: "race",
      value: "hispanic",
      source: "canvasser",
      noted_by: canvasserId,
    },
    { onConflict: "voter_id,key" },
  );
  assert.ifError(error);

  const hispanic = await evaluateCohort(manager, {
    demographics: { race: ["hispanic"], education: ["college"] },
  });
  assert.deepEqual(hispanic.voterIds, [voterIds["E"]], "door observation overrides the file");

  const white = await evaluateCohort(manager, {
    demographics: { race: ["white"], education: ["college"] },
  });
  assert.ok(!white.voterIds.includes(voterIds["E"]), "E no longer counted as file-race");
});

test("personal_context extracted (prompt v3) and feeds the persuasion profile", async () => {
  // The user's own counter-stereotype example, scripted.
  const transcript = [
    { speaker: "S0", ts: 0, text: "Hi! I'm with the Rivera campaign — I use automated notes so I can focus on our chat. Anything on your mind about the county?" },
    { speaker: "S1", ts: 8, text: "Look, I'm a Republican and people assume things, but immigration is personal for me. I served a church mission in Chile, I speak Spanish, and I've spent years as a church leader working with Spanish-speaking immigrant families here. I volunteer at the legal aid clinic downtown helping folks with their paperwork." },
    { speaker: "S0", ts: 30, text: "That's real experience. Rivera wants the county to fund that same legal aid clinic — does that land with you?" },
    { speaker: "S1", ts: 38, text: "Honestly, yes. That would matter to me a lot more than the usual talking points. I haven't decided on this race yet, but that's the kind of thing that would move me." },
  ];
  contextConvoId = randomUUID();
  await service.from("conversations").insert({
    id: contextConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterIds["E"],
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    consent_disclosed_at: new Date().toISOString(),
    contact_result: "full_conversation",
    status: "transcribed",
    transcript: transcript as unknown as Json,
  });

  const stats = await processAvailable(service, deepgramKey);
  assert.equal(stats.failed, 0);

  const { data: signal } = await service
    .from("signals")
    .select("id, personal_context, prompt_version")
    .eq("conversation_id", contextConvoId)
    .single();
  contextSignalId = signal!.id;
  assert.equal(signal!.prompt_version, "extract-signal.v3");
  const context = (signal!.personal_context ?? []).join(" | ").toLowerCase();
  assert.ok((signal!.personal_context ?? []).length >= 2, "multiple durable facts captured");
  assert.match(context, /chile|spanish/, "mission/language facts retained");
  assert.match(context, /church|clinic|legal aid|immigrant/, "community-role facts retained");

  const profile = await fetchPersuasionProfile(manager, voterIds["E"]);
  assert.ok(profile.personalContext.length >= 2, "profile aggregates personal context");
  assert.equal(profile.precedence, "individual_over_cohort");
  assert.ok(
    profile.observedAttributes.some((a) => a.key === "race" && a.value === "hispanic"),
    "profile carries door-observed attributes",
  );
});

test("personal_context survives a retention purge of the transcript", async () => {
  await service
    .from("conversations")
    .update({ recorded_at: new Date(Date.now() - 800 * 86_400_000).toISOString() })
    .eq("id", contextConvoId);

  const sweep = await runRetentionSweep(service);
  assert.equal(sweep.errors.length, 0, sweep.errors.join("; "));

  const { data: convo } = await service
    .from("conversations")
    .select("transcript")
    .eq("id", contextConvoId)
    .single();
  assert.equal(convo!.transcript, null, "raw transcript purged");

  const { data: signal } = await service
    .from("signals")
    .select("personal_context")
    .eq("id", contextSignalId)
    .single();
  assert.ok(
    (signal!.personal_context ?? []).length >= 2,
    "connection facts survive — the campaign still remembers the person",
  );
});

test("door poll answers queue offline and sync idempotently", async () => {
  const { data: question, error: qErr } = await manager
    .from("survey_questions")
    .insert({
      campaign_id: campaignA,
      question: "M65: Which issue matters most to you this election?",
      options: ["Property taxes", "Schools", "Water", "Something else"],
      position: 1,
    })
    .select("id")
    .single();
  assert.ifError(qErr);

  const convoId = randomUUID();
  const capture: QueuedCapture = {
    id: convoId,
    kind: "conversation",
    campaignId: campaignA,
    canvasserId,
    shiftId: null,
    voterId: voterIds["A"],
    walkListItemId: null,
    audioUri: null,
    recordedAt: new Date().toISOString(),
    gpsLat: null,
    gpsLng: null,
    consentDisclosedAt: new Date().toISOString(),
    contactResult: "brief_exchange",
    stopStatus: null,
    surveyResponses: [{ questionId: question!.id, answer: "Property taxes" }],
    attempts: 0,
    lastError: null,
  };

  let online = false;
  const store = createMemoryQueueStore();
  const ports: SyncPorts = {
    store,
    isOnline: async () => online,
    readAudio: async () => new Uint8Array(),
    uploadAudio: async () => {},
    upsertConversation: async (c) => {
      const { error } = await canvasser.from("conversations").upsert(
        {
          id: c.id,
          campaign_id: c.campaignId,
          canvasser_id: c.canvasserId,
          voter_id: c.voterId,
          voter_id_manual: true,
          recorded_at: c.recordedAt,
          consent_disclosed_at: c.consentDisclosedAt,
          contact_result: c.contactResult,
          status: "captured",
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(error.message);
    },
    updateStopStatus: async () => {},
    saveSurveyResponses: async (c) => {
      const { error } = await canvasser.from("survey_responses").upsert(
        (c.surveyResponses ?? []).map((r) => ({
          campaign_id: c.campaignId,
          question_id: r.questionId,
          conversation_id: c.id,
          voter_id: c.voterId,
          answer: r.answer,
        })),
        { onConflict: "question_id,conversation_id" },
      );
      if (error) throw new Error(error.message);
    },
  };

  await store.add(capture);
  const offline = await syncQueue(ports);
  assert.equal(offline.synced, 0, "held while offline");

  online = true;
  const synced = await syncQueue(ports);
  assert.equal(synced.synced, 1);

  const { data: responses } = await service
    .from("survey_responses")
    .select("answer")
    .eq("conversation_id", convoId);
  assert.equal(responses!.length, 1);
  assert.equal(responses![0].answer, "Property taxes");

  // Idempotent re-sync.
  await store.add({ ...capture, attempts: 0 });
  await syncQueue(ports);
  const { count } = await service
    .from("survey_responses")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", convoId);
  assert.equal(count, 1, "no duplicate answers");
});

test("isolation: campaign B sees no attributes, questions, or cohorts", async () => {
  const [attrs, questions, cohorts] = await Promise.all([
    clientB.from("voter_attributes").select("id"),
    clientB.from("survey_questions").select("id").like("question", "M65%"),
    clientB.from("cohorts").select("id"),
  ]);
  assert.equal(attrs.data!.length, 0);
  assert.equal(questions.data!.length, 0);
  assert.equal(cohorts.data!.length, 0);
});
