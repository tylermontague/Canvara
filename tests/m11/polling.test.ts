// M11 exit test: polling instruments.
//  - persuasion delta computed exactly from seeded pre/post intention
//    pairs (refusals and unpaired pre-asks excluded)
//  - stated issue rankings score exactly (Borda, top-3)
//  - the offline sync engine lands pre/post/only rows with phases and
//    ordered rank answers through the same upsert path the device uses
//  - one response per question per conversation PER PHASE (replaces)
//  - sample graying + campaign isolation
//
// Run after m0/m1 (needs campaign A and M1 voters).

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
  fetchPersuasionDelta,
  fetchRankStanding,
  syncQueue,
  type QueuedCapture,
  type SyncPorts,
} from "@canvara/shared";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const MARKER = "m11-poll/";
const Q_PREFIX = "M11 ";
const RANK_ISSUES = ["economy", "taxes", "safety", "schools", "water"];

// Delta seed: 20 pre/post pairs on republican voters →
//   8 undecided pre (5 → ours, 3 hold), 6 opponent pre (1 → undecided,
//   5 hold), 6 ours pre (1 → undecided, 5 hold).
//   toward 6, away 1, held 13, net +25% exactly.
// Plus 2 pre-only (unpaired) and 2 refused pairs — all excluded.
const PAIRS: { pre: string; post: string }[] = [
  ...Array(5).fill({ pre: "undecided", post: "our_candidate" }),
  ...Array(3).fill({ pre: "undecided", post: "undecided" }),
  { pre: "opponent", post: "undecided" },
  ...Array(5).fill({ pre: "opponent", post: "opponent" }),
  { pre: "our_candidate", post: "undecided" },
  ...Array(5).fill({ pre: "our_candidate", post: "our_candidate" }),
];
const EXPECTED = { pairs: 20, toward: 6, away: 1, held: 13, netPct: 25 };

// Rank seed: 12 voters answer [economy, taxes, safety], 8 answer
// [taxes, economy, water] → economy 52, taxes 48, safety 12, water 8.
const RANK_ANSWERS = [
  ...Array(12).fill(["economy", "taxes", "safety"]),
  ...Array(8).fill(["taxes", "economy", "water"]),
] as string[][];
const EXPECTED_SCORES = { economy: 52, taxes: 48, safety: 12, water: 8 };

let campaignA: string;
let canvasserId: string;
let manager: DbClient;
let canvasser: DbClient;
let clientB: DbClient;
let intentionQId: string;
let rankQId: string;
let choiceQId: string;
let repVoterIds: string[] = []; // untouched REP voters for the seeds

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

  // Teardown: responses reference questions without cascade — clear them
  // first, then questions, then the seeded conversations.
  const { data: oldQs } = await service
    .from("survey_questions")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("question", `${Q_PREFIX}%`);
  const oldQIds = (oldQs ?? []).map((q) => q.id);
  if (oldQIds.length > 0) {
    const { error: respErr } = await service
      .from("survey_responses")
      .delete()
      .in("question_id", oldQIds);
    if (respErr) throw new Error(`teardown responses: ${respErr.message}`);
    const { error: qErr } = await service.from("survey_questions").delete().in("id", oldQIds);
    if (qErr) throw new Error(`teardown questions: ${qErr.message}`);
  }
  {
    const { error } = await service
      .from("conversations")
      .delete()
      .like("audio_path", `${MARKER}%`);
    if (error) throw new Error(`teardown conversations: ${error.message}`);
  }

  // Instruments.
  const { data: qs, error: qErr } = await service
    .from("survey_questions")
    .insert([
      {
        campaign_id: campaignA,
        question: `${Q_PREFIX}Cold test: who do you plan to vote for?`,
        options: [...INTENTION_OPTIONS],
        kind: "intention",
        position: 0,
      },
      {
        campaign_id: campaignA,
        question: `${Q_PREFIX}Which issues matter most to you?`,
        options: RANK_ISSUES,
        kind: "rank",
        position: 1,
      },
      {
        campaign_id: campaignA,
        question: `${Q_PREFIX}Do you support the bond measure?`,
        options: ["yes", "no", "unsure"],
        kind: "choice",
        position: 2,
      },
    ])
    .select("id, kind");
  if (qErr) throw new Error(`seed questions: ${qErr.message}`);
  intentionQId = qs!.find((q) => q.kind === "intention")!.id;
  rankQId = qs!.find((q) => q.kind === "rank")!.id;
  choiceQId = qs!.find((q) => q.kind === "choice")!.id;

  // Untouched registered-REP voters (M1 order index ≥ 500 — no other
  // suite reaches them).
  const { data: pool, error: poolErr } = await service
    .from("voters")
    .select("id, party")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .order("external_id")
    .range(500, 1499);
  if (poolErr) throw new Error(poolErr.message);
  repVoterIds = (pool ?? []).filter((v) => v.party === "REP").map((v) => v.id);
  if (repVoterIds.length < 30) throw new Error("Run `npm run test:m1` first (needs voters).");

  // Seed conversations + responses: 20 pairs, 2 pre-only, 2 refused pairs.
  const conversations: TablesInsert<"conversations">[] = [];
  const responses: TablesInsert<"survey_responses">[] = [];
  const addConversation = (voterId: string) => {
    const id = randomUUID();
    conversations.push({
      id,
      campaign_id: campaignA,
      canvasser_id: canvasserId,
      voter_id: voterId,
      voter_id_manual: true,
      audio_path: `${MARKER}${id}.m4a`,
      recorded_at: new Date().toISOString(),
      contact_result: "full_conversation",
      status: "captured",
    });
    return id;
  };

  PAIRS.forEach((pair, i) => {
    const convoId = addConversation(repVoterIds[i]);
    responses.push(
      {
        campaign_id: campaignA,
        question_id: intentionQId,
        conversation_id: convoId,
        voter_id: repVoterIds[i],
        answer: pair.pre,
        phase: "pre",
      },
      {
        campaign_id: campaignA,
        question_id: intentionQId,
        conversation_id: convoId,
        voter_id: repVoterIds[i],
        answer: pair.post,
        phase: "post",
      },
    );
    // The same 20 conversations carry the cold issue ranking.
    responses.push({
      campaign_id: campaignA,
      question_id: rankQId,
      conversation_id: convoId,
      voter_id: repVoterIds[i],
      answer_items: RANK_ANSWERS[i],
      phase: "pre",
    });
  });
  // 2 unpaired pre-asks (door closed before the re-ask).
  for (let i = 20; i < 22; i++) {
    const convoId = addConversation(repVoterIds[i]);
    responses.push({
      campaign_id: campaignA,
      question_id: intentionQId,
      conversation_id: convoId,
      voter_id: repVoterIds[i],
      answer: "undecided",
      phase: "pre",
    });
  }
  // 2 refused pairs — a refusal is not a position; excluded from movement.
  for (let i = 22; i < 24; i++) {
    const convoId = addConversation(repVoterIds[i]);
    responses.push(
      {
        campaign_id: campaignA,
        question_id: intentionQId,
        conversation_id: convoId,
        voter_id: repVoterIds[i],
        answer: "refused",
        phase: "pre",
      },
      {
        campaign_id: campaignA,
        question_id: intentionQId,
        conversation_id: convoId,
        voter_id: repVoterIds[i],
        answer: "our_candidate",
        phase: "post",
      },
    );
  }

  {
    const { error } = await service.from("conversations").insert(conversations);
    if (error) throw new Error(`seed conversations: ${error.message}`);
  }
  for (let i = 0; i < responses.length; i += 100) {
    const { error } = await service.from("survey_responses").insert(responses.slice(i, i + 100));
    if (error) throw new Error(`seed responses: ${error.message}`);
  }

  manager = await signIn(USER_A.email, USER_A.password);
  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
});

test("persuasion delta: exact movement from the seeded pre/post pairs", async () => {
  const deltas = await fetchPersuasionDelta(manager, "party");
  const rep = deltas.find((d) => d.segment === "republican")!;
  assert.equal(rep.pairs, EXPECTED.pairs, "refused + unpaired excluded");
  assert.equal(rep.movedToward, EXPECTED.toward);
  assert.equal(rep.movedAway, EXPECTED.away);
  assert.equal(rep.held, EXPECTED.held);
  assert.equal(rep.insufficientSample, false);
  assert.ok(Math.abs(rep.netMovementPct! - EXPECTED.netPct) < 1e-9, "net +25%");

  // Segments with no pairs are grayed, never percentaged.
  for (const d of deltas) {
    if (d.pairs < SEGMENT_MIN_SAMPLE) {
      assert.equal(d.insufficientSample, true, d.segment);
      assert.equal(d.netMovementPct, null, d.segment);
    }
  }
});

test("stated issue ranking: exact Borda scores and order", async () => {
  const standing = await fetchRankStanding(manager, rankQId, "party");
  const rep = standing.find((s) => s.segment === "republican")!;
  assert.equal(rep.responses, 20);
  assert.deepEqual(rep.scores, EXPECTED_SCORES);
  assert.deepEqual(rep.order, ["economy", "taxes", "safety", "water"]);
  assert.equal(rep.insufficientSample, false);

  const dem = standing.find((s) => s.segment === "democrat")!;
  assert.equal(dem.responses, 0);
  assert.equal(dem.insufficientSample, true);
  assert.deepEqual(dem.order, []);
});

test("sync engine: a device capture lands pre/post/only rows with phases", async () => {
  const voterId = repVoterIds[24];
  const capture: QueuedCapture = {
    id: randomUUID(),
    kind: "conversation",
    campaignId: campaignA,
    canvasserId,
    shiftId: null,
    voterId,
    walkListItemId: null,
    audioUri: null,
    recordedAt: new Date().toISOString(),
    gpsLat: null,
    gpsLng: null,
    consentDisclosedAt: new Date().toISOString(),
    contactResult: "full_conversation",
    stopStatus: null,
    surveyResponses: [
      { questionId: intentionQId, answer: "undecided", phase: "pre" },
      { questionId: rankQId, answerItems: ["water", "taxes", "economy"], phase: "pre" },
      { questionId: intentionQId, answer: "our_candidate", phase: "post" },
      { questionId: choiceQId, answer: "yes" }, // phase defaults to 'only'
    ],
    attempts: 0,
    lastError: null,
  };

  // The same ports shape the device uses (apps/field/src/lib/sync.ts),
  // minus audio — run twice to prove the phase-keyed upsert is idempotent.
  const store = createMemoryQueueStore();
  await store.add(capture);
  const ports: SyncPorts = {
    store,
    isOnline: async () => true,
    readAudio: async () => new Uint8Array(),
    uploadAudio: async () => {},
    async upsertConversation(c, audioPath) {
      const { error } = await canvasser.from("conversations").upsert(
        {
          id: c.id,
          campaign_id: c.campaignId,
          canvasser_id: c.canvasserId,
          voter_id: c.voterId,
          voter_id_manual: true,
          audio_path: audioPath ?? `${MARKER}${c.id}.m4a`,
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
    async saveSurveyResponses(c) {
      const rows = (c.surveyResponses ?? []).map((r) => ({
        campaign_id: c.campaignId,
        question_id: r.questionId,
        conversation_id: c.id,
        voter_id: c.voterId,
        answer: r.answer ?? null,
        answer_items: r.answerItems ?? null,
        phase: r.phase ?? "only",
      }));
      const { error } = await canvasser
        .from("survey_responses")
        .upsert(rows, { onConflict: "question_id,conversation_id,phase" });
      if (error) throw new Error(error.message);
    },
  };

  const first = await syncQueue(ports);
  assert.equal(first.synced, 1);
  await store.add({ ...capture, attempts: 0 }); // simulate a duplicate sync
  const second = await syncQueue(ports);
  assert.equal(second.synced, 1, "idempotent re-sync");

  const { data: rows } = await service
    .from("survey_responses")
    .select("question_id, phase, answer, answer_items")
    .eq("conversation_id", capture.id)
    .order("phase");
  assert.equal(rows!.length, 4, "exactly four rows — no duplicates");
  const rank = rows!.find((r) => r.question_id === rankQId)!;
  assert.deepEqual(rank.answer_items, ["water", "taxes", "economy"], "order preserved");
  assert.equal(rank.phase, "pre");
  const only = rows!.find((r) => r.question_id === choiceQId)!;
  assert.equal(only.phase, "only");
  assert.equal(only.answer, "yes");
  const intents = rows!.filter((r) => r.question_id === intentionQId);
  assert.deepEqual(
    intents.map((r) => [r.phase, r.answer]).sort(),
    [
      ["post", "our_candidate"],
      ["pre", "undecided"],
    ],
    "the pre/post pair",
  );
});

test("one response per question per conversation per phase — re-ask replaces", async () => {
  const convoId = randomUUID();
  await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: repVoterIds[25],
    voter_id_manual: true,
    audio_path: `${MARKER}${convoId}.m4a`,
    recorded_at: new Date().toISOString(),
    contact_result: "brief_exchange",
    status: "captured",
  });

  const base = {
    campaign_id: campaignA,
    question_id: intentionQId,
    conversation_id: convoId,
    voter_id: repVoterIds[25],
    phase: "pre",
  };
  await service
    .from("survey_responses")
    .upsert({ ...base, answer: "opponent" }, { onConflict: "question_id,conversation_id,phase" });
  await service
    .from("survey_responses")
    .upsert({ ...base, answer: "undecided" }, { onConflict: "question_id,conversation_id,phase" });

  const { data } = await service
    .from("survey_responses")
    .select("answer")
    .eq("conversation_id", convoId)
    .eq("phase", "pre");
  assert.equal(data!.length, 1, "phase-keyed upsert replaces");
  assert.equal(data![0].answer, "undecided");

  // A response must carry an answer of some kind.
  const { error } = await service.from("survey_responses").insert({
    campaign_id: campaignA,
    question_id: intentionQId,
    conversation_id: convoId,
    voter_id: repVoterIds[25],
    phase: "post",
  });
  assert.ok(error, "answer-or-items check constraint rejects empty responses");
});

test("isolation: campaign B sees no M11 instruments or responses", async () => {
  const [questions, responses] = await Promise.all([
    clientB.from("survey_questions").select("id").like("question", `${Q_PREFIX}%`),
    clientB.from("survey_responses").select("id").eq("question_id", intentionQId),
  ]);
  assert.equal(questions.data!.length, 0);
  assert.equal(responses.data!.length, 0);
});
