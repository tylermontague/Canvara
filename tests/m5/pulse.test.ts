// M5 exit test (BUILD_PLAN.md §5): "100 seeded conversations render correct
// aggregates and drill-down."
//
// Seeds 100 conversations+signals with an EXACTLY known distribution,
// salience profile, and daily spread, then reads them back through the same
// shared pulse helpers the dashboard uses — as the campaign-A user under
// RLS — and asserts every aggregate to the digit. Drill-down: the voter
// card and transcript queries return the seeded conversation content.
//
// Seed design (index i = 0..99):
//   support:  0-29 strong_support · 30-54 lean_support · 55-74 undecided ·
//             75-89 lean_oppose · 90-99 strong_oppose
//   property_taxes: i<60  (spontaneous i<40; negative i<50, positive 50-59)
//   schools:        40-69 (spontaneous 40-49; positive 40-64, negative 65-69)
//   water:          70-77 (all spontaneous, all negative)
//   transit:        97-99 (prompted, neutral) → below ISSUE_MIN_MENTIONS
//   days: i%10 → 2026-06-20 + (i%10) days, so 10 conversations per day
//
// Expected aggregates:
//   distribution: 30/25/20/15/10, total 100, sufficient sample
//   salience: property_taxes 60m/40s, schools 30m/10s, water 8m/8s,
//             transit 3m/0s (insufficient flag)
//   order: property_taxes, schools, water, transit
//   trend: 10 days × 10; per-day support mix derives from the index ranges

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
  type TablesInsert,
} from "@canvara/db";
import {
  fetchSupportDistribution,
  fetchIssueSalience,
  fetchDailyTrend,
} from "@canvara/shared";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { ensureCanvasser } from "../helpers";

const SEED_MARKER = "m5-seed/";
const BASE_DAY = Date.UTC(2026, 5, 20, 15, 0, 0); // 2026-06-20T15:00Z — mid-day, no day-boundary ambiguity

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let canvasserId: string;
let clientA: DbClient;
let clientB: DbClient;
let voterIds: string[] = [];
let drillVoterId: string; // voter attached to conversation index 0
let drillConvoId: string;

function supportFor(i: number): string {
  if (i < 30) return "strong_support";
  if (i < 55) return "lean_support";
  if (i < 75) return "undecided";
  if (i < 90) return "lean_oppose";
  return "strong_oppose";
}

function signalFor(i: number) {
  const topIssues: string[] = [];
  const sentiment: Record<string, string> = {};
  const provenance: Record<string, string> = {};

  if (i < 60) {
    topIssues.push("property_taxes");
    sentiment["property_taxes"] = i < 50 ? "negative" : "positive";
    provenance["property_taxes"] = i < 40 ? "spontaneous" : "prompted";
  }
  if (i >= 40 && i < 70) {
    topIssues.push("schools");
    sentiment["schools"] = i < 65 ? "positive" : "negative";
    provenance["schools"] = i < 50 ? "spontaneous" : "prompted";
  }
  if (i >= 70 && i < 78) {
    topIssues.push("water");
    sentiment["water"] = "negative";
    provenance["water"] = "spontaneous";
  }
  if (i >= 97) {
    topIssues.push("transit");
    sentiment["transit"] = "neutral";
    provenance["transit"] = "prompted";
  }
  return { topIssues, sentiment, provenance };
}

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

  // Teardown: ALL conversations for the test canvasser (M3/M4 leftovers
  // pollute the aggregates; the canvasser is test-only).
  const { data: oldConvos } = await service
    .from("conversations")
    .select("id")
    .eq("canvasser_id", canvasserId);
  const oldIds = (oldConvos ?? []).map((c) => c.id);
  if (oldIds.length > 0) {
    await service.from("review_queue").delete().in("conversation_id", oldIds);
    await service.from("conversations").delete().in("id", oldIds);
  }
  // Also clear any signals from other campaign-A profiles (M0 seed rows) so
  // the pulse numbers are exactly the seeded 100.
  const { data: stray } = await service.from("signals").select("conversation_id").eq("campaign_id", campaignA);
  const strayIds = (stray ?? []).map((s) => s.conversation_id);
  if (strayIds.length > 0) {
    await service.from("review_queue").delete().in("conversation_id", strayIds);
    await service.from("conversations").delete().in("id", strayIds);
  }

  const { data: voters } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .order("external_id")
    .limit(20);
  if (!voters || voters.length < 20) throw new Error("Run `npm run test:m1` first (needs voters).");
  voterIds = voters.map((v) => v.id);

  // Seed 100 conversations + signals.
  const conversations: TablesInsert<"conversations">[] = [];
  const signals: TablesInsert<"signals">[] = [];
  for (let i = 0; i < 100; i++) {
    const convoId = randomUUID();
    const voterId = voterIds[i % voterIds.length];
    if (i === 0) {
      drillVoterId = voterId;
      drillConvoId = convoId;
    }
    conversations.push({
      id: convoId,
      campaign_id: campaignA,
      canvasser_id: canvasserId,
      voter_id: voterId,
      voter_id_manual: true,
      audio_path: `${SEED_MARKER}${convoId}.m4a`,
      recorded_at: new Date(BASE_DAY + (i % 10) * 86_400_000).toISOString(),
      consent_disclosed_at: new Date(BASE_DAY + (i % 10) * 86_400_000).toISOString(),
      contact_result: "full_conversation",
      status: "extracted",
      transcript: [
        { speaker: "S0", ts: 0, text: "Hi, quick chat about the county race? I use automated notes." },
        { speaker: "S1", ts: 4, text: `Seeded voter response number ${i}.` },
      ] as unknown as Json,
    });
    const { topIssues, sentiment, provenance } = signalFor(i);
    signals.push({
      campaign_id: campaignA,
      conversation_id: convoId,
      support_level: supportFor(i),
      top_issues: topIssues,
      issue_sentiment: sentiment as unknown as Json,
      provenance: provenance as unknown as Json,
      emotional_valence: "neutral",
      persuadability: "persuadable",
      confidence_score: 0.9,
      model_used: "m5-seed",
      prompt_version: "m5-seed",
      debrief_summary: `Seeded conversation ${i}.`,
    });
  }
  for (let i = 0; i < conversations.length; i += 50) {
    const { error } = await service.from("conversations").insert(conversations.slice(i, i + 50));
    if (error) throw new Error(`seed conversations: ${error.message}`);
  }
  for (let i = 0; i < signals.length; i += 50) {
    const { error } = await service.from("signals").insert(signals.slice(i, i + 50));
    if (error) throw new Error(`seed signals: ${error.message}`);
  }

  clientA = await signIn(USER_A.email, USER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
});

test("support distribution matches the seeded numbers exactly", async () => {
  const dist = await fetchSupportDistribution(clientA);
  assert.equal(dist.total, 100);
  assert.equal(dist.insufficientSample, false, "100 ≥ threshold");
  assert.equal(dist.counts["strong_support"], 30);
  assert.equal(dist.counts["lean_support"], 25);
  assert.equal(dist.counts["undecided"], 20);
  assert.equal(dist.counts["lean_oppose"], 15);
  assert.equal(dist.counts["strong_oppose"], 10);
});

test("issue salience: counts, spontaneous shares, sentiment, ordering, graying", async () => {
  const issues = await fetchIssueSalience(clientA);
  assert.deepEqual(
    issues.map((i) => i.issue),
    ["property_taxes", "schools", "water", "transit"],
    "salience order: spontaneous mentions first",
  );

  const byIssue = Object.fromEntries(issues.map((i) => [i.issue, i]));
  assert.deepEqual(
    {
      mentions: byIssue["property_taxes"].mentions,
      spontaneous: byIssue["property_taxes"].spontaneous,
      negative: byIssue["property_taxes"].negative,
      positive: byIssue["property_taxes"].positive,
    },
    { mentions: 60, spontaneous: 40, negative: 50, positive: 10 },
  );
  assert.deepEqual(
    {
      mentions: byIssue["schools"].mentions,
      spontaneous: byIssue["schools"].spontaneous,
      positive: byIssue["schools"].positive,
      negative: byIssue["schools"].negative,
    },
    { mentions: 30, spontaneous: 10, positive: 25, negative: 5 },
  );
  assert.deepEqual(
    { mentions: byIssue["water"].mentions, spontaneous: byIssue["water"].spontaneous },
    { mentions: 8, spontaneous: 8 },
  );
  assert.equal(byIssue["water"].insufficientSample, false);
  assert.equal(byIssue["transit"].mentions, 3);
  assert.equal(byIssue["transit"].insufficientSample, true, "transit grayed below threshold");
});

test("daily trend: 10 days × 10 conversations with correct net support", async () => {
  const trend = await fetchDailyTrend(clientA);
  assert.equal(trend.length, 10, "ten distinct days");
  for (const day of trend) {
    assert.equal(day.total, 10, `${day.day} has 10 conversations`);
    assert.notEqual(day.netSupport, null, "above the per-day threshold");
  }
  // Sum across days must reproduce the distribution.
  const summed: Record<string, number> = {};
  for (const day of trend) {
    for (const [level, n] of Object.entries(day.counts)) {
      summed[level] = (summed[level] ?? 0) + n;
    }
  }
  assert.deepEqual(summed, {
    strong_support: 30,
    lean_support: 25,
    undecided: 20,
    lean_oppose: 15,
    strong_oppose: 10,
  });
  // Every index range spreads evenly (10/day), so each day nets
  // (3+2.5−1.5−1)/10 — but ranges aren't multiples of 10 for all levels;
  // verify via the definition instead of a constant:
  for (const day of trend) {
    const support = (day.counts["strong_support"] ?? 0) + (day.counts["lean_support"] ?? 0);
    const oppose = (day.counts["strong_oppose"] ?? 0) + (day.counts["lean_oppose"] ?? 0);
    assert.equal(day.netSupport, (support - oppose) / day.total);
  }
});

test("drill-down: voter card sees the seeded conversations and transcript", async () => {
  // The same queries the voter card + transcript pages run, as user A.
  const { data: convos, error } = await clientA
    .from("conversations")
    .select("id, recorded_at, transcript, signals(support_level, debrief_summary)")
    .eq("voter_id", drillVoterId)
    .order("recorded_at", { ascending: false });
  assert.ifError(error);
  assert.ok(convos!.length >= 1, "voter has conversation history");

  const drill = convos!.find((c) => c.id === drillConvoId);
  assert.ok(drill, "seeded conversation visible on the voter card");
  const transcript = drill!.transcript as { speaker: string; text: string }[];
  assert.equal(transcript.length, 2);
  assert.match(transcript[1].text, /Seeded voter response number 0/);
  assert.equal(drill!.signals!.support_level, "strong_support");
  assert.ok(drill!.signals!.debrief_summary);
});

test("campaign B sees empty aggregates (isolation holds for views)", async () => {
  const dist = await fetchSupportDistribution(clientB);
  // Campaign B has only its M0 seed signal (support 'undecided', 1 row).
  assert.ok(dist.total <= 1, `campaign B total ${dist.total} — none of the seeded 100`);
  const issues = await fetchIssueSalience(clientB);
  assert.ok(
    issues.every((i) => !["water", "transit"].includes(i.issue)),
    "no seeded issues leak to campaign B",
  );
});
