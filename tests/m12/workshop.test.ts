// M12 exit test: Voter Contact Workshop.
//  - Sonnet drafts poll questions grounded in evidence; every draft gets
//    a Fable NEUTRALITY verdict; a blatant push-poll question is flagged
//    with a suggested neutral rewrite
//  - sparks draft with the alienation guardrail; approval is leadership-
//    only; approved sparks are what devices cache
//  - per-spark effectiveness is exact math over seeded usages and
//    pre/post pairs (refusals and unpaired excluded, sample graying)
//  - the offline engine lands spark usages idempotently under RLS
//
// Makes real Sonnet + Fable calls (like M7). Run after m0/m1.

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type TablesInsert,
} from "@canvara/db";
import {
  INTENTION_OPTIONS,
  SEGMENT_MIN_SAMPLE,
  createMemoryQueueStore,
  fetchSparkEffects,
  syncQueue,
  type QueuedCapture,
  type SyncPorts,
} from "@canvara/shared";
import {
  generatePollQuestions,
  generateSparks,
  runNeutralityGuardrail,
} from "@canvara/messaging";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const MARKER = "m12-effect/";
const Q_PREFIX = "M12 ";

// Effect seed: 20 usages on the main spark → 15 clean pairs
// (6 toward, 2 away, 7 held → net +26.66%), 2 refused pairs and
// 3 unpaired pre-asks excluded.
const EFFECT_PAIRS: { pre: string; post: string }[] = [
  ...Array(6).fill({ pre: "undecided", post: "our_candidate" }),
  ...Array(2).fill({ pre: "undecided", post: "opponent" }),
  ...Array(7).fill({ pre: "opponent", post: "opponent" }),
];
const EXPECTED = { usages: 20, pairs: 15, toward: 6, away: 2, held: 7 };

let campaignA: string;
let canvasserId: string;
let managerId: string;
let manager: DbClient;
let canvasser: DbClient;
let clientB: DbClient;
let intentionQId: string;
let effectSparkId: string;
let thinSparkId: string;

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
  canvasserId = await ensureCanvasser(service, campaignA);

  // Teardown. Approved drafts from a prior run copied their (LLM-worded)
  // question into survey_questions — find those via the drafts table
  // BEFORE wiping it.
  const { data: oldDrafts } = await service
    .from("question_drafts")
    .select("question")
    .eq("campaign_id", campaignA);
  const oldQuestionTexts = (oldDrafts ?? []).map((d) => d.question);
  if (oldQuestionTexts.length > 0) {
    const { data: copies } = await service
      .from("survey_questions")
      .select("id")
      .eq("campaign_id", campaignA)
      .in("question", oldQuestionTexts);
    const copyIds = (copies ?? []).map((c) => c.id);
    if (copyIds.length > 0) {
      await service.from("survey_responses").delete().in("question_id", copyIds);
      await service.from("survey_questions").delete().in("id", copyIds);
    }
  }
  await service.from("question_drafts").delete().eq("campaign_id", campaignA);
  // spark_usages cascade from sparks; conversations cascade their rows.
  await service.from("sparks").delete().eq("campaign_id", campaignA);
  {
    const { data: oldQs } = await service
      .from("survey_questions")
      .select("id")
      .eq("campaign_id", campaignA)
      .like("question", `${Q_PREFIX}%`);
    const ids = (oldQs ?? []).map((q) => q.id);
    if (ids.length > 0) {
      await service.from("survey_responses").delete().in("question_id", ids);
      await service.from("survey_questions").delete().in("id", ids);
    }
  }
  {
    const { error } = await service
      .from("conversations")
      .delete()
      .like("audio_path", `${MARKER}%`);
    if (error) throw new Error(`teardown conversations: ${error.message}`);
  }

  manager = await signIn(USER_A.email, USER_A.password);
  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
  const {
    data: { user },
  } = await manager.auth.getUser();
  managerId = user!.id;

  // ----- Deterministic effect seed (no LLM involved) -----
  const { data: iq, error: iqErr } = await service
    .from("survey_questions")
    .insert({
      campaign_id: campaignA,
      question: `${Q_PREFIX}Cold test (effect seed)`,
      options: [...INTENTION_OPTIONS],
      kind: "intention",
      active: false, // seed instrument only — keep it off canvasser devices
    })
    .select("id")
    .single();
  if (iqErr) throw new Error(`seed intention q: ${iqErr.message}`);
  intentionQId = iq!.id;

  const { data: sparks, error: sparkErr } = await service
    .from("sparks")
    .insert([
      {
        campaign_id: campaignA,
        title: "M12-EFFECT seed spark",
        opener: "What would you fix first around here?",
        evidence: {},
        status: "approved",
        model_used: "m12-seed",
        prompt_version: "m12-seed",
      },
      {
        campaign_id: campaignA,
        title: "M12-THIN seed spark",
        opener: "Seen the new park plans?",
        evidence: {},
        status: "approved",
        model_used: "m12-seed",
        prompt_version: "m12-seed",
      },
    ])
    .select("id, title");
  if (sparkErr) throw new Error(`seed sparks: ${sparkErr.message}`);
  effectSparkId = sparks!.find((s) => s.title.startsWith("M12-EFFECT"))!.id;
  thinSparkId = sparks!.find((s) => s.title.startsWith("M12-THIN"))!.id;

  const conversations: TablesInsert<"conversations">[] = [];
  const responses: TablesInsert<"survey_responses">[] = [];
  const usages: TablesInsert<"spark_usages">[] = [];
  const addConversation = () => {
    const id = randomUUID();
    conversations.push({
      id,
      campaign_id: campaignA,
      canvasser_id: canvasserId,
      voter_id: null, // effect math is per-conversation; no segment needed
      voter_id_manual: false,
      audio_path: `${MARKER}${id}.m4a`,
      recorded_at: new Date().toISOString(),
      contact_result: "full_conversation",
      status: "captured",
    });
    return id;
  };
  const addIntention = (convoId: string, phase: string, answer: string) =>
    responses.push({
      campaign_id: campaignA,
      question_id: intentionQId,
      conversation_id: convoId,
      answer,
      phase,
    });

  for (const pair of EFFECT_PAIRS) {
    const convoId = addConversation();
    usages.push({ campaign_id: campaignA, spark_id: effectSparkId, conversation_id: convoId });
    addIntention(convoId, "pre", pair.pre);
    addIntention(convoId, "post", pair.post);
  }
  for (let i = 0; i < 2; i++) {
    const convoId = addConversation(); // refused pre — not a position
    usages.push({ campaign_id: campaignA, spark_id: effectSparkId, conversation_id: convoId });
    addIntention(convoId, "pre", "refused");
    addIntention(convoId, "post", "our_candidate");
  }
  for (let i = 0; i < 3; i++) {
    const convoId = addConversation(); // pre only — door closed early
    usages.push({ campaign_id: campaignA, spark_id: effectSparkId, conversation_id: convoId });
    addIntention(convoId, "pre", "undecided");
  }
  // Thin spark: 3 clean pairs — real movement, sample too small to show.
  for (let i = 0; i < 3; i++) {
    const convoId = addConversation();
    usages.push({ campaign_id: campaignA, spark_id: thinSparkId, conversation_id: convoId });
    addIntention(convoId, "pre", "undecided");
    addIntention(convoId, "post", "our_candidate");
  }

  {
    const { error } = await service.from("conversations").insert(conversations);
    if (error) throw new Error(`seed conversations: ${error.message}`);
  }
  for (let i = 0; i < responses.length; i += 100) {
    const { error } = await service.from("survey_responses").insert(responses.slice(i, i + 100));
    if (error) throw new Error(`seed responses: ${error.message}`);
  }
  {
    const { error } = await service.from("spark_usages").insert(usages);
    if (error) throw new Error(`seed usages: ${error.message}`);
  }
});

test("neutrality guardrail flags a blatant push-poll question", async () => {
  const result = await runNeutralityGuardrail({
    question:
      "Don't you agree that the county's reckless overspending on wasteful pet projects must finally be stopped?",
    options: ["Yes, absolutely", "I suppose so", "No"],
  });
  assert.equal(result.verdict, "flag", "push-poll wording must not pass");
  assert.ok(
    result.leading_wording || result.loaded_language || result.unbalanced_options,
    "at least one rubric check names the problem",
  );
  assert.ok(result.suggested_fix.length > 10, "offers a neutral rewrite");
});

test("poll questions: drafted from evidence, every draft carries a verdict", async () => {
  const drafts = await generatePollQuestions(manager, {
    campaignId: campaignA,
    actorId: managerId,
    focus: "how voters feel about the county water conservation fee",
  });
  assert.ok(drafts.length >= 2, "multiple variants drafted");
  for (const d of drafts) {
    assert.ok(d.question.trim().length > 10, "substantive question");
    assert.ok(d.options.length >= 3, "fixed choices offered");
    assert.ok(d.guardrail.verdict === "pass" || d.guardrail.verdict === "flag");
  }
  assert.ok(
    drafts.some((d) => d.guardrail.verdict === "pass"),
    "at least one variant is neutral enough to use",
  );

  const { data: rows } = await service
    .from("question_drafts")
    .select("status, prompt_version, guardrail_verdict")
    .eq("campaign_id", campaignA);
  assert.ok(rows!.length >= drafts.length);
  assert.ok(rows!.every((r) => r.status === "draft" && r.prompt_version === "draft-poll-questions.v1"));
});

test("approving a draft copies it into the live door poll (leadership)", async () => {
  const { data: draft } = await manager
    .from("question_drafts")
    .select("id, question, options")
    .eq("status", "draft")
    .eq("guardrail_verdict", "pass")
    .limit(1)
    .single();
  assert.ok(draft, "a passing draft exists");

  // The console approval action: copy to survey_questions, mark the draft.
  const { error: insertErr } = await manager.from("survey_questions").insert({
    campaign_id: campaignA,
    question: draft!.question,
    options: draft!.options,
    kind: "choice",
    position: 99,
  });
  assert.ifError(insertErr);
  const { error: updateErr } = await manager
    .from("question_drafts")
    .update({ status: "approved", approved_by: managerId, approved_at: new Date().toISOString() })
    .eq("id", draft!.id);
  assert.ifError(updateErr);

  const { data: live } = await service
    .from("survey_questions")
    .select("kind, active")
    .eq("campaign_id", campaignA)
    .eq("question", draft!.question)
    .single();
  assert.equal(live!.kind, "choice");
  assert.equal(live!.active, true);
});

test("sparks: drafted campaign-wide, guardrailed, approval is leadership-only", async () => {
  const sparks = await generateSparks(manager, {
    campaignId: campaignA,
    actorId: managerId,
  });
  assert.ok(sparks.length >= 2, "multiple sparks drafted");
  for (const s of sparks) {
    assert.ok(s.opener.trim().length > 10, "substantive opener");
    assert.ok(s.guardrail.verdict === "pass" || s.guardrail.verdict === "flag");
  }

  const target = sparks[0];
  // A canvasser cannot approve (leadership-only update policy).
  await canvasser.from("sparks").update({ status: "approved" }).eq("id", target.id);
  const { data: unchanged } = await service
    .from("sparks")
    .select("status")
    .eq("id", target.id)
    .single();
  assert.equal(unchanged!.status, "draft", "canvasser approval blocked by RLS");

  // Leadership can.
  const { error } = await manager
    .from("sparks")
    .update({ status: "approved", approved_by: managerId, approved_at: new Date().toISOString() })
    .eq("id", target.id);
  assert.ifError(error);

  // Devices cache exactly the approved set (what syncDown pulls).
  const { data: approved } = await canvasser
    .from("sparks")
    .select("id")
    .eq("status", "approved");
  assert.ok(approved!.some((s) => s.id === target.id), "approved spark visible to canvassers");
});

test("spark effectiveness: exact movement, refusals/unpaired excluded, thin samples grayed", async () => {
  const effects = await fetchSparkEffects(manager);
  const main = effects.find((e) => e.sparkId === effectSparkId)!;
  assert.equal(main.usages, EXPECTED.usages);
  assert.equal(main.pairs, EXPECTED.pairs);
  assert.equal(main.movedToward, EXPECTED.toward);
  assert.equal(main.movedAway, EXPECTED.away);
  assert.equal(main.held, EXPECTED.held);
  assert.equal(main.insufficientSample, false);
  assert.ok(
    Math.abs(main.netMovementPct! - ((EXPECTED.toward - EXPECTED.away) / EXPECTED.pairs) * 100) <
      1e-9,
    "net movement exact",
  );

  const thin = effects.find((e) => e.sparkId === thinSparkId)!;
  assert.equal(thin.usages, 3);
  assert.equal(thin.pairs, 3);
  assert.ok(thin.pairs < SEGMENT_MIN_SAMPLE);
  assert.equal(thin.insufficientSample, true);
  assert.equal(thin.netMovementPct, null, "100% movement on 3 pairs shows NOTHING");
});

test("offline path: spark usages sync idempotently from a device capture", async () => {
  const capture: QueuedCapture = {
    id: randomUUID(),
    kind: "conversation",
    campaignId: campaignA,
    canvasserId,
    shiftId: null,
    voterId: null,
    walkListItemId: null,
    audioUri: null,
    recordedAt: new Date().toISOString(),
    gpsLat: null,
    gpsLng: null,
    consentDisclosedAt: new Date().toISOString(),
    contactResult: "brief_exchange",
    stopStatus: null,
    sparkIds: [effectSparkId],
    attempts: 0,
    lastError: null,
  };
  const store = createMemoryQueueStore();
  const ports: SyncPorts = {
    store,
    isOnline: async () => true,
    readAudio: async () => new Uint8Array(),
    uploadAudio: async () => {},
    async upsertConversation(c) {
      const { error } = await canvasser.from("conversations").upsert(
        {
          id: c.id,
          campaign_id: c.campaignId,
          canvasser_id: c.canvasserId,
          voter_id: null,
          voter_id_manual: false,
          audio_path: `${MARKER}${c.id}.m4a`,
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
    async saveSparkUsages(c) {
      const rows = (c.sparkIds ?? []).map((sparkId) => ({
        campaign_id: c.campaignId,
        spark_id: sparkId,
        conversation_id: c.id,
      }));
      const { error } = await canvasser
        .from("spark_usages")
        .upsert(rows, { onConflict: "spark_id,conversation_id" });
      if (error) throw new Error(error.message);
    },
  };

  await store.add(capture);
  assert.equal((await syncQueue(ports)).synced, 1);
  await store.add({ ...capture, attempts: 0 });
  assert.equal((await syncQueue(ports)).synced, 1, "idempotent re-sync");

  const { count } = await service
    .from("spark_usages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", capture.id);
  assert.equal(count, 1, "exactly one usage row");
});

test("isolation: campaign B sees no workshop artifacts", async () => {
  const [drafts, sparks, usages] = await Promise.all([
    clientB.from("question_drafts").select("id"),
    clientB.from("sparks").select("id"),
    clientB.from("spark_usages").select("id"),
  ]);
  assert.equal(drafts.data!.length, 0);
  assert.equal(sparks.data!.length, 0);
  assert.equal(usages.data!.length, 0);
});
