// M6 exit test (BUILD_PLAN.md §5): pilot hardening.
//  - Belief engine v1: exact Beta updates (spontaneous 2 / prompted 1 /
//    absence 0.5) and half-life decay, feeding the tier-2 briefing fetch
//  - Retention (CX-2): audio + transcript purged past retention_days with
//    an audit entry; recent conversations untouched; idempotent
//  - Settings RLS: canvassers cannot edit campaign settings, managers can
//  - Pipeline health view returns per-status counts under RLS

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
  updateBeliefsForSignal,
  fetchVoterBeliefs,
  decayParam,
  BELIEF_HALF_LIFE_DAYS,
} from "@canvara/shared";
import { runRetentionSweep } from "@canvara/worker/retention";
import { CAMPAIGN_A, USER_A } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const T0 = "2026-07-01T12:00:00.000Z";
const T1 = T0; // same instant — zero decay between obs 1 and 2
const DAYS_120 = 120 * 86_400_000;
const T2 = new Date(new Date(T1).getTime() + DAYS_120).toISOString();

let campaignA: string;
let canvasserId: string;
let canvasser: DbClient;
let manager: DbClient;
let voterId: string;
let oldConvoId: string;
let recentConvoId: string;
let oldAudioPath: string;

const approx = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≈ ${expected}`);

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id, retention_days")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;
  assert.equal(campaign.retention_days, 730, "test assumes the default retention");
  canvasserId = await ensureCanvasser(service, campaignA);

  const { data: voter } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .limit(1)
    .single();
  if (!voter) throw new Error("Run `npm run test:m1` first.");
  voterId = voter.id;

  // Clean slate for this voter's beliefs.
  await service.from("belief_states").delete().eq("voter_id", voterId);

  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  manager = await signIn(USER_A.email, USER_A.password);
});

test("belief updates: spontaneous and prompted weights land exactly", async () => {
  // Conversation 1: property_taxes spontaneous, schools prompted.
  const r1 = await updateBeliefsForSignal(service, {
    campaignId: campaignA,
    voterId,
    topIssues: ["property_taxes", "schools"],
    provenance: { property_taxes: "spontaneous", schools: "prompted" },
    observedAt: T0,
    fullConversation: true,
  });
  assert.equal(r1.updated, 2);
  assert.deepEqual(r1.skippedUnknown, []);

  // Conversation 2 (same instant, zero decay): property_taxes again,
  // spontaneous; schools absent in a full conversation.
  await updateBeliefsForSignal(service, {
    campaignId: campaignA,
    voterId,
    topIssues: ["property_taxes"],
    provenance: { property_taxes: "spontaneous" },
    observedAt: T1,
    fullConversation: true,
  });

  const { data: beliefs } = await service
    .from("belief_states")
    .select("issue_id, alpha, beta")
    .eq("voter_id", voterId);
  const byIssue = Object.fromEntries(beliefs!.map((b) => [b.issue_id, b]));

  // property_taxes: 1 +2 +2 = 5; β untouched = 1
  approx(byIssue["property_taxes"].alpha, 5, "pt alpha");
  approx(byIssue["property_taxes"].beta, 1, "pt beta");
  // schools: 1 +1 = 2; absent once → β = 1 + 0.5
  approx(byIssue["schools"].alpha, 2, "schools alpha");
  approx(byIssue["schools"].beta, 1.5, "schools beta");
});

test("beliefs decay toward the prior with the configured half-life", async () => {
  // 120 days later (= 2 half-lives): property_taxes mentioned, prompted;
  // schools absent again.
  await updateBeliefsForSignal(service, {
    campaignId: campaignA,
    voterId,
    topIssues: ["property_taxes"],
    provenance: { property_taxes: "prompted" },
    observedAt: T2,
    fullConversation: true,
  });

  const { data: beliefs } = await service
    .from("belief_states")
    .select("issue_id, alpha, beta")
    .eq("voter_id", voterId);
  const byIssue = Object.fromEntries(beliefs!.map((b) => [b.issue_id, b]));

  // property_taxes: α 5 → 1 + 4·2^(−120/60) = 2, then +1 (prompted) = 3
  approx(byIssue["property_taxes"].alpha, 3, "pt alpha after decay");
  approx(byIssue["property_taxes"].beta, 1, "pt beta after decay");
  // schools: α 2 → 1.25; β 1.5 → 1.125, then +0.5 (absent) = 1.625
  approx(byIssue["schools"].alpha, 1.25, "schools alpha after decay");
  approx(byIssue["schools"].beta, 1.625, "schools beta after decay");

  // Sanity on the pure function the assertions derive from.
  approx(decayParam(5, 2 * BELIEF_HALF_LIFE_DAYS), 2, "decayParam two half-lives");
});

test("issues outside the taxonomy are skipped, not written", async () => {
  const result = await updateBeliefsForSignal(service, {
    campaignId: campaignA,
    voterId,
    topIssues: ["quantum_lizards"],
    provenance: { quantum_lizards: "spontaneous" },
    observedAt: T2,
    fullConversation: false,
  });
  assert.deepEqual(result.skippedUnknown, ["quantum_lizards"]);
  const { data } = await service
    .from("belief_states")
    .select("issue_id")
    .eq("voter_id", voterId)
    .eq("issue_id", "quantum_lizards");
  assert.equal(data!.length, 0, "no belief row for unknown slug");
});

test("tier-2 briefing: canvasser reads ranked beliefs under RLS", async () => {
  const map = await fetchVoterBeliefs(canvasser, [voterId]);
  const list = map.get(voterId)!;
  assert.ok(list.length >= 2);
  assert.equal(list[0].issue, "property_taxes", "strongest belief first");
  approx(list[0].mean, 3 / 4, "pt mean = α/(α+β)");
  assert.ok(list[0].mean > list[1].mean, "ordering by mean");
});

test("retention: expired raw content purged with audit; recent untouched; idempotent", async () => {
  // 800 days old (past the 730-day default) with audio + transcript.
  oldConvoId = randomUUID();
  oldAudioPath = `${campaignA}/${oldConvoId}.m4a`;
  const bytes = new TextEncoder().encode("m6-retention-test-audio");
  const { error: upErr } = await service.storage
    .from("conversations")
    .upload(oldAudioPath, bytes, { contentType: "audio/mp4", upsert: true });
  assert.ifError(upErr as Error | null);

  const transcript = [{ speaker: "S0", ts: 0, text: "old conversation" }];
  await service.from("conversations").insert({
    id: oldConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    audio_path: oldAudioPath,
    recorded_at: new Date(Date.now() - 800 * 86_400_000).toISOString(),
    status: "complete",
    transcript: transcript as unknown as Json,
  });

  // Recent conversation with content — must survive.
  recentConvoId = randomUUID();
  const recentPath = `${campaignA}/${recentConvoId}.m4a`;
  await service.storage
    .from("conversations")
    .upload(recentPath, bytes, { contentType: "audio/mp4", upsert: true });
  await service.from("conversations").insert({
    id: recentConvoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: voterId,
    voter_id_manual: true,
    audio_path: recentPath,
    recorded_at: new Date().toISOString(),
    status: "complete",
    transcript: transcript as unknown as Json,
  });

  const sweep = await runRetentionSweep(service);
  assert.equal(sweep.errors.length, 0, sweep.errors.join("; "));
  assert.ok(sweep.purged >= 1, "at least the expired conversation purged");

  const { data: oldAfter } = await service
    .from("conversations")
    .select("audio_path, transcript")
    .eq("id", oldConvoId)
    .single();
  assert.equal(oldAfter!.audio_path, null, "expired audio path cleared");
  assert.equal(oldAfter!.transcript, null, "expired transcript cleared");

  const { error: dlErr } = await service.storage.from("conversations").download(oldAudioPath);
  assert.ok(dlErr, "expired audio object deleted from storage");

  const { data: recentAfter } = await service
    .from("conversations")
    .select("audio_path, transcript")
    .eq("id", recentConvoId)
    .single();
  assert.equal(recentAfter!.audio_path, recentPath, "recent audio untouched");
  assert.ok(recentAfter!.transcript, "recent transcript untouched");

  const { data: audits } = await service
    .from("audit_log")
    .select("action, detail")
    .eq("entity_id", oldConvoId)
    .eq("action", "retention_purged");
  assert.equal(audits!.length, 1, "purge audited");
  assert.equal((audits![0].detail as { retention_days: number }).retention_days, 730);

  // Idempotent: nothing left to purge for this conversation.
  const sweep2 = await runRetentionSweep(service);
  const { data: audits2 } = await service
    .from("audit_log")
    .select("id")
    .eq("entity_id", oldConvoId)
    .eq("action", "retention_purged");
  assert.equal(audits2!.length, 1, "no duplicate purge audit");
  assert.equal(sweep2.errors.length, 0);
});

test("campaign settings: canvasser blocked by RLS, manager allowed", async () => {
  const { data: denied, error: deniedErr } = await canvasser
    .from("campaigns")
    .update({ retention_days: 100 })
    .eq("id", campaignA)
    .select("id");
  assert.ifError(deniedErr);
  assert.equal(denied!.length, 0, "canvasser update matches zero rows");

  const { data: allowed, error: allowedErr } = await manager
    .from("campaigns")
    .update({ retention_days: 731 })
    .eq("id", campaignA)
    .select("id, retention_days");
  assert.ifError(allowedErr);
  assert.equal(allowed!.length, 1, "manager update succeeds");

  // Restore the default.
  await manager.from("campaigns").update({ retention_days: 730 }).eq("id", campaignA);
  const { data: check } = await service
    .from("campaigns")
    .select("retention_days")
    .eq("id", campaignA)
    .single();
  assert.equal(check!.retention_days, 730);
});

test("pipeline health view: per-status counts match ground truth under RLS", async () => {
  const { data: health, error } = await manager
    .from("pipeline_health")
    .select("status, n");
  assert.ifError(error);
  const viewTotal = (health ?? []).reduce((sum, r) => sum + r.n, 0);

  const { count } = await service
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignA);
  assert.equal(viewTotal, count, "view total equals campaign conversation count");
  assert.ok((health ?? []).some((r) => r.status === "complete"), "statuses broken out");
});
