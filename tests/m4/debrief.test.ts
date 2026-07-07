// M4 exit test (BUILD_PLAN.md §5): "correction round-trips into the stored
// signal and audit log."
//
// End to end: the pipeline produces a signal WITH a debrief summary (FA-5),
// the canvasser confirms/corrects it under RLS through the same shared
// helper the app ships, a manager adjudicates the review queue (IE-8), and
// every mutation lands in corrections jsonb (training data) + audit_log.
//
// Prereqs: .env keys, migrations 1–4, seed:m0 + test:m1 artifacts.

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
import { submitDebrief, resolveReview } from "@canvara/shared";
import { processAvailable } from "@canvara/worker/pipeline";
import { CAMPAIGN_A, USER_A } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";
import { SCRIPTED_TRANSCRIPT, GARBLED_TRANSCRIPT } from "../m3/fixtures";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);
const deepgramKey = process.env.DEEPGRAM_API_KEY ?? "";

let campaignA: string;
let canvasserId: string;
let canvasser: DbClient;
let manager: DbClient;
let voterId: string;

// Populated across tests (node:test runs sequentially within a file).
let mainConvoId: string;
let mainSignal: { id: string; support_level: string | null; top_issues: string[] };
let reviewConvoId: string;
let reviewItemId: string;
let reviewSignalId: string;

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

  // Teardown prior M4/M3 conversations for the test canvasser.
  const { data: oldConvos } = await service
    .from("conversations")
    .select("id")
    .eq("canvasser_id", canvasserId);
  const oldIds = (oldConvos ?? []).map((c) => c.id);
  if (oldIds.length > 0) {
    await service.from("review_queue").delete().in("conversation_id", oldIds);
    await service.from("conversations").delete().in("id", oldIds);
  }

  const { data: voter } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .limit(1)
    .single();
  if (!voter) throw new Error("No M1 voters — run `npm run test:m1` first.");
  voterId = voter.id;

  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  manager = await signIn(USER_A.email, USER_A.password);
});

test("pipeline produces a debrief summary alongside the signal (FA-5)", async () => {
  mainConvoId = randomUUID();
  const { error } = await service.from("conversations").insert({
    id: mainConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    consent_disclosed_at: new Date().toISOString(),
    status: "transcribed",
    transcript: SCRIPTED_TRANSCRIPT as unknown as Json,
  });
  assert.ifError(error);

  const stats = await processAvailable(service, deepgramKey);
  assert.equal(stats.failed, 0);

  const { data: signal } = await service
    .from("signals")
    .select("id, support_level, top_issues, debrief_summary, canvasser_confirmed")
    .eq("conversation_id", mainConvoId)
    .single();
  assert.ok(signal, "signal exists");
  assert.ok(
    (signal!.debrief_summary ?? "").length > 40,
    "debrief summary generated and substantive",
  );
  assert.equal(signal!.canvasser_confirmed, false, "awaiting canvasser debrief");
  mainSignal = {
    id: signal!.id,
    support_level: signal!.support_level,
    top_issues: signal!.top_issues ?? [],
  };
});

test("canvasser correction round-trips into the stored signal and audit log", async () => {
  // The canvasser knows the door: voter actually leans oppose, and one
  // extracted issue is wrong — remove it.
  const keptIssues = mainSignal.top_issues.slice(0, 1);
  await submitDebrief(canvasser, {
    signalId: mainSignal.id,
    conversationId: mainConvoId,
    campaignId: campaignA,
    actorId: canvasserId,
    corrections: [
      { field: "support_level", from: mainSignal.support_level, to: "lean_oppose" },
      { field: "top_issues", from: mainSignal.top_issues, to: keptIssues },
    ],
  });

  const { data: signal } = await service
    .from("signals")
    .select("support_level, top_issues, corrections, canvasser_confirmed")
    .eq("id", mainSignal.id)
    .single();
  assert.equal(signal!.support_level, "lean_oppose", "correction stored on the signal");
  assert.deepEqual(signal!.top_issues, keptIssues, "issue removal stored");
  assert.equal(signal!.canvasser_confirmed, true, "signal confirmed");

  const corrections = signal!.corrections as {
    field: string;
    from: unknown;
    to: unknown;
    corrected_by: string;
    source: string;
  }[];
  assert.equal(corrections.length, 2, "both corrections logged as training data");
  assert.ok(
    corrections.every((c) => c.corrected_by === canvasserId && c.source === "debrief"),
    "corrections attributed to the canvasser",
  );

  const { data: convo } = await service
    .from("conversations")
    .select("status")
    .eq("id", mainConvoId)
    .single();
  assert.equal(convo!.status, "complete", "conversation completed");

  const { data: audits } = await service
    .from("audit_log")
    .select("action, actor_id, detail")
    .eq("entity", "signal")
    .eq("entity_id", mainSignal.id)
    .eq("action", "debrief_corrected");
  assert.equal(audits!.length, 1, "audit entry written");
  assert.equal(audits![0].actor_id, canvasserId);
  const detail = audits![0].detail as { corrections: unknown[] };
  assert.equal(detail.corrections.length, 2, "audit carries the corrections");
});

test("pure confirmation (no corrections) also lands in the audit log", async () => {
  const convoId = randomUUID();
  await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    status: "extracted",
  });
  const { data: signal } = await service
    .from("signals")
    .insert({
      campaign_id: campaignA,
      conversation_id: convoId,
      support_level: "lean_support",
      confidence_score: 0.85,
      model_used: "claude-haiku-4-5",
      prompt_version: "extract-signal.v2",
      debrief_summary: "You spoke with a supportive voter.",
    })
    .select("id")
    .single();

  await submitDebrief(canvasser, {
    signalId: signal!.id,
    conversationId: convoId,
    campaignId: campaignA,
    actorId: canvasserId,
    corrections: [],
  });

  const { data: after } = await service
    .from("signals")
    .select("canvasser_confirmed, corrections")
    .eq("id", signal!.id)
    .single();
  assert.equal(after!.canvasser_confirmed, true);
  assert.deepEqual(after!.corrections, [], "no corrections logged on pure confirm");

  const { data: audits } = await service
    .from("audit_log")
    .select("action")
    .eq("entity_id", signal!.id)
    .eq("action", "debrief_confirmed");
  assert.equal(audits!.length, 1, "confirmation audited");
});

test("manager adjudicates a review item; resolution + correction recorded (IE-8)", async () => {
  // A low-confidence conversation in review.
  reviewConvoId = randomUUID();
  await service.from("conversations").insert({
    id: reviewConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    status: "review",
    transcript: GARBLED_TRANSCRIPT as unknown as Json,
  });
  const { data: signal } = await service
    .from("signals")
    .insert({
      campaign_id: campaignA,
      conversation_id: reviewConvoId,
      support_level: "unknown",
      persuadability: "persuadable",
      confidence_score: 0.35,
      model_used: "claude-sonnet-4-6",
      prompt_version: "extract-signal.v2",
    })
    .select("id")
    .single();
  reviewSignalId = signal!.id;
  const { data: review } = await service
    .from("review_queue")
    .insert({
      campaign_id: campaignA,
      conversation_id: reviewConvoId,
      reason: "low_confidence",
    })
    .select("id")
    .single();
  reviewItemId = review!.id;

  const { data: managerUser } = await manager.auth.getUser();
  await resolveReview(manager, {
    reviewId: reviewItemId,
    signalId: reviewSignalId,
    conversationId: reviewConvoId,
    campaignId: campaignA,
    actorId: managerUser.user!.id,
    corrections: [{ field: "persuadability", from: "persuadable", to: "disengaged" }],
  });

  const { data: item } = await service
    .from("review_queue")
    .select("status, resolved_by, resolution")
    .eq("id", reviewItemId)
    .single();
  assert.equal(item!.status, "resolved");
  assert.equal(item!.resolved_by, managerUser.user!.id);
  const resolution = item!.resolution as { action: string; corrections: unknown[] };
  assert.equal(resolution.action, "corrected");
  assert.equal(resolution.corrections.length, 1);

  const { data: signalAfter } = await service
    .from("signals")
    .select("persuadability, corrections")
    .eq("id", reviewSignalId)
    .single();
  assert.equal(signalAfter!.persuadability, "disengaged", "reviewer correction stored");
  const corrections = signalAfter!.corrections as { source: string }[];
  assert.equal(corrections[0].source, "review", "correction attributed to review");

  const { data: convo } = await service
    .from("conversations")
    .select("status")
    .eq("id", reviewConvoId)
    .single();
  assert.equal(convo!.status, "extracted", "conversation back to extracted, debrief pending");

  const { data: audits } = await service
    .from("audit_log")
    .select("action")
    .eq("entity", "review_queue")
    .eq("entity_id", reviewItemId);
  assert.equal(audits!.length, 1, "resolution audited");
});

test("a resolved review item cannot be resolved twice", async () => {
  const { data: managerUser } = await manager.auth.getUser();
  await assert.rejects(
    resolveReview(manager, {
      reviewId: reviewItemId,
      signalId: reviewSignalId,
      conversationId: reviewConvoId,
      campaignId: campaignA,
      actorId: managerUser.user!.id,
      corrections: [],
    }),
    /not open/,
    "second resolution rejected",
  );
});
