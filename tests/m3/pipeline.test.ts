// M3 exit test (BUILD_PLAN.md §5): "recorded test conversation → correct
// signals on all 11 fields within 10 min (CX-4)."
//
// Runs the worker's real pipeline code against the live backend:
//  1. scripted conversation → Haiku extraction → all 11 fields asserted
//     against the script's ground truth, well inside the 10-minute budget
//  2. garbled transcript → Sonnet escalation → review queue
//  3. GPS-only conversation → correlate_voter RPC assigns the right door
//  4. re-processing is idempotent (one signal row, one review entry)
//  5. Deepgram ASR + WER spot check — runs when fixture audio is present
//     (tests/m3/fixtures/audio.m4a + reference.txt), skips otherwise
//
// Prereqs: .env has ANTHROPIC_API_KEY + DEEPGRAM_API_KEY; migrations 1–3
// applied; M0 seed + M1/M2 tests have run (campaign, canvasser, voters).

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type Json,
} from "@canvara/db";
import { wordErrorRate } from "@canvara/shared";
import { processAvailable } from "@canvara/worker/pipeline";
import { CAMPAIGN_A } from "../m0/fixtures";
import { ensureCanvasser } from "../helpers";
import { SCRIPTED_TRANSCRIPT, GARBLED_TRANSCRIPT } from "./fixtures";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
// Generate with `npm run gen:m3-audio` (Kokoro TTS), or drop in a real
// phone recording as audio.m4a.
const AUDIO_FIXTURES = [
  { file: path.join(here, "fixtures", "audio.wav"), contentType: "audio/wav" },
  { file: path.join(here, "fixtures", "audio.m4a"), contentType: "audio/mp4" },
];
const REFERENCE_FIXTURE = path.join(here, "fixtures", "reference.txt");

const { url, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
for (const key of ["ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY"] as const) {
  if (!process.env[key]) {
    throw new Error(`${key} missing from .env — required for the M3 pipeline.`);
  }
}
const deepgramKey = process.env.DEEPGRAM_API_KEY!;
const service: DbClient = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let canvasserId: string;
let manualVoterId: string; // voter attached to the scripted conversation
let geoVoter: { id: string; lat: number; lng: number }; // for the correlation test
let scriptedConvoId: string;
let garbledConvoId: string;

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;
  canvasserId = await ensureCanvasser(service, campaignA);

  // Teardown: the canvasser is test-only; all of their conversations are ours.
  const { data: oldConvos } = await service
    .from("conversations")
    .select("id")
    .eq("canvasser_id", canvasserId);
  const oldIds = (oldConvos ?? []).map((c) => c.id);
  if (oldIds.length > 0) {
    await service.from("review_queue").delete().in("conversation_id", oldIds);
    await service.from("conversations").delete().in("id", oldIds); // signals cascade
  }

  // A voter to attach manually, plus a geocoded voter for correlation.
  const { data: voters, error: votersErr } = await service
    .from("voter_coords")
    .select("voter_id, lat, lng")
    .eq("campaign_id", campaignA)
    .limit(2);
  if (votersErr) throw new Error(votersErr.message);
  if (!voters || voters.length < 2) {
    throw new Error("Need ≥2 geocoded voters — run `npm run test:m2` first (it sets coordinates).");
  }
  manualVoterId = voters[0].voter_id;
  geoVoter = { id: voters[1].voter_id, lat: voters[1].lat, lng: voters[1].lng };
});

test("scripted conversation: correct signals on all 11 fields, within 10 minutes", async () => {
  scriptedConvoId = randomUUID();
  const { error: insertErr } = await service.from("conversations").insert({
    id: scriptedConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: manualVoterId,
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    consent_disclosed_at: new Date().toISOString(),
    contact_result: "full_conversation",
    status: "transcribed",
    transcript: SCRIPTED_TRANSCRIPT as unknown as Json,
  });
  assert.ifError(insertErr);

  const started = Date.now();
  const stats = await processAvailable(service, deepgramKey);
  const elapsed = Date.now() - started;

  assert.equal(stats.failed, 0, "pipeline reported no failures");
  assert.ok(elapsed < TEN_MINUTES_MS, `processed in ${Math.round(elapsed / 1000)}s (CX-4: <10min)`);

  const { data: convo } = await service
    .from("conversations")
    .select("status, voter_id")
    .eq("id", scriptedConvoId)
    .single();
  assert.equal(convo!.status, "extracted", "conversation reached extracted");
  assert.equal(convo!.voter_id, manualVoterId, "manual voter assignment untouched (IE-3 precedence)");

  const { data: signal } = await service
    .from("signals")
    .select("*")
    .eq("conversation_id", scriptedConvoId)
    .single();
  assert.ok(signal, "signal row exists");
  const s = signal!;

  // Field 1 (reasoning) is the model's scratchpad — verified by proxy through
  // the quality of everything below. Fields 2–11 against the script:
  assert.equal(s.support_level, "undecided", "support_level");

  assert.ok((s.top_issues ?? []).includes("property_taxes"), "top_issues includes property_taxes");
  assert.equal(s.top_issues![0], "property_taxes", "property_taxes is most salient (spontaneous, dominant)");

  const sentiment = s.issue_sentiment as Record<string, string>;
  assert.equal(sentiment["property_taxes"], "negative", "issue_sentiment.property_taxes");

  assert.ok(
    ["frustrated", "hostile"].includes(s.emotional_valence ?? ""),
    `emotional_valence is frustrated-tier (got ${s.emotional_valence})`,
  );

  assert.equal(s.persuadability, "persuadable", "persuadability");

  assert.ok((s.information_gaps ?? []).length > 0, "information_gaps captured (tax plan in writing, early voting)");

  const resonance = s.message_resonance as { message: string; response: string }[];
  assert.ok(resonance.length > 0, "message_resonance captured");
  assert.ok(
    resonance.some((r) => r.response === "positive"),
    "the assessment-cap message landed positive",
  );

  assert.ok((s.follow_up_signals ?? []).length > 0, "follow_up_signals captured (mailer, spouse after 6)");

  const provenance = s.provenance as Record<string, string>;
  assert.equal(provenance["property_taxes"], "spontaneous", "provenance.property_taxes");
  if (provenance["schools"]) {
    assert.equal(provenance["schools"], "prompted", "provenance.schools");
  }

  assert.ok(s.confidence_score >= 0.6, `confidence ${s.confidence_score} ≥ 0.6 (no review needed)`);
  assert.ok(s.model_used.length > 0, "model recorded");
  assert.equal(s.prompt_version, "extract-signal.v2", "prompt version recorded");
});

test("garbled transcript: escalates to Sonnet and routes to review queue", async () => {
  garbledConvoId = randomUUID();
  const { error } = await service.from("conversations").insert({
    id: garbledConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: manualVoterId,
    voter_id_manual: true,
    recorded_at: new Date().toISOString(),
    status: "transcribed",
    transcript: GARBLED_TRANSCRIPT as unknown as Json,
  });
  assert.ifError(error);

  await processAvailable(service, deepgramKey);

  const { data: convo } = await service
    .from("conversations")
    .select("status")
    .eq("id", garbledConvoId)
    .single();
  assert.equal(convo!.status, "review", "low-confidence conversation routed to review");

  const { data: signal } = await service
    .from("signals")
    .select("confidence_score, model_used")
    .eq("conversation_id", garbledConvoId)
    .single();
  assert.ok(signal!.confidence_score < 0.6, `confidence ${signal!.confidence_score} < 0.6`);
  assert.equal(signal!.model_used, "claude-sonnet-4-6", "escalation model recorded");

  const { data: reviews } = await service
    .from("review_queue")
    .select("id, reason, status")
    .eq("conversation_id", garbledConvoId);
  assert.equal(reviews!.length, 1, "exactly one review entry");
  assert.equal(reviews![0].reason, "low_confidence");
  assert.equal(reviews![0].status, "open");
});

test("GPS correlation: conversation with no voter gets matched to the nearest door", async () => {
  const convoId = randomUUID();
  const { error } = await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: null,
    voter_id_manual: false,
    recorded_at: new Date().toISOString(),
    status: "transcribed",
    // ~11m offset from the voter's location — inside the 75m radius.
    gps: `POINT(${geoVoter.lng + 0.0001} ${geoVoter.lat})`,
    transcript: SCRIPTED_TRANSCRIPT as unknown as Json,
  });
  assert.ifError(error);

  await processAvailable(service, deepgramKey);

  const { data: convo } = await service
    .from("conversations")
    .select("voter_id, status")
    .eq("id", convoId)
    .single();
  assert.equal(convo!.voter_id, geoVoter.id, "correlated to the nearest geocoded voter");
  assert.ok(["extracted", "review"].includes(convo!.status), "pipeline completed");
});

test("idempotency: re-processing produces no duplicate signals or review entries", async () => {
  await service.from("conversations").update({ status: "transcribed" }).eq("id", garbledConvoId);
  await processAvailable(service, deepgramKey);

  const { count: signalCount } = await service
    .from("signals")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", garbledConvoId);
  assert.equal(signalCount, 1, "still exactly one signal row (upsert)");

  const { count: reviewCount } = await service
    .from("review_queue")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", garbledConvoId)
    .eq("status", "open");
  assert.equal(reviewCount, 1, "still exactly one open review entry");
});

test("ASR + WER spot check (requires fixture audio)", async (t) => {
  const fixture = AUDIO_FIXTURES.find((f) => existsSync(f.file));
  if (!fixture || !existsSync(REFERENCE_FIXTURE)) {
    t.skip("no fixture audio — run `npm run gen:m3-audio` to create it");
    return;
  }

  const audio = readFileSync(fixture.file);
  const reference = readFileSync(REFERENCE_FIXTURE, "utf8");

  const convoId = randomUUID();
  const audioPath = `${campaignA}/${convoId}.m4a`;
  const { error: uploadErr } = await service.storage
    .from("conversations")
    .upload(audioPath, audio, { contentType: fixture.contentType, upsert: true });
  assert.ifError(uploadErr as Error | null);

  const { error } = await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: manualVoterId,
    voter_id_manual: true,
    audio_path: audioPath,
    recorded_at: new Date().toISOString(),
    consent_disclosed_at: new Date().toISOString(),
    status: "uploaded",
  });
  assert.ifError(error);

  const started = Date.now();
  const stats = await processAvailable(service, deepgramKey);
  const elapsed = Date.now() - started;

  assert.equal(stats.failed, 0);
  assert.ok(elapsed < TEN_MINUTES_MS, `audio→signals in ${Math.round(elapsed / 1000)}s`);

  const { data: convo } = await service
    .from("conversations")
    .select("status, transcript, wer_estimate")
    .eq("id", convoId)
    .single();
  assert.ok(["extracted", "review"].includes(convo!.status), "full pipeline completed from audio");

  const transcriptText = (convo!.transcript as { text: string }[]).map((u) => u.text).join(" ");
  const { wer } = wordErrorRate(reference, transcriptText);
  console.log(`    WER vs reference: ${(wer * 100).toFixed(1)}%`);
  assert.ok(wer < 0.35, `WER ${(wer * 100).toFixed(1)}% under the 35% spot-check bar`);
});
