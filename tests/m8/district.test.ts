// M8 exit test: district operations map + dashboard stats.
//  - turnout computed exactly from seeded vote history, with the
//    "last similar cycle" pick (2026 midterm → 2022 general)
//  - canvassed / other-contact counts move by exactly the seeded deltas
//  - map point views return party + coordinates under RLS
//  - signs and events: members can place them; campaign B sees nothing

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
import { fetchDistrictStats, classifyElection } from "@canvara/shared";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const SEEDED = 200; // voters given coords + vote history
const VOTED_2024 = 120; // 60%
const VOTED_2022 = 80; // 40%

let campaignA: string;
let canvasserId: string;
let manager: DbClient;
let canvasser: DbClient;
let clientB: DbClient;
let seededVoterIds: string[] = [];
let baseline: { canvassed: number; otherContacted: number };

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

  // Teardown prior M8 artifacts.
  await service.from("yard_signs").delete().eq("campaign_id", campaignA);
  await service.from("campaign_events").delete().eq("campaign_id", campaignA);
  await service.from("contact_log").delete().eq("campaign_id", campaignA);
  await service.from("conversations").delete().like("audio_path", "m8-canvass/%");

  // Seed coords + vote history onto the first 200 M1 voters (Mesa grid).
  const { data: voters, error: votersErr } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .order("external_id")
    .limit(SEEDED);
  if (votersErr) throw new Error(votersErr.message);
  if ((voters?.length ?? 0) < SEEDED) throw new Error("Run `npm run test:m1` first.");
  seededVoterIds = voters!.map((v) => v.id);

  for (let i = 0; i < SEEDED; i++) {
    const lat = 33.39 + Math.floor(i / 20) * 0.004;
    const lng = -111.86 + (i % 20) * 0.004;
    const voteHistory = {
      "2024_general": i % 10 < 6, // 120 true
      "2022_general": i % 10 < 4, // 80 true
    };
    const { error } = await service
      .from("voters")
      .update({
        location: `POINT(${lng} ${lat})`,
        vote_history: voteHistory as unknown as Json,
      })
      .eq("id", seededVoterIds[i]);
    if (error) throw new Error(`seed voter ${i}: ${error.message}`);
  }

  manager = await signIn(USER_A.email, USER_A.password);
  canvasser = await signIn(CANVASSER_A.email, CANVASSER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);

  // Baseline contact counts (earlier suites leave conversations behind).
  const stats = await fetchDistrictStats(manager, 2026);
  baseline = { canvassed: stats.canvassed, otherContacted: stats.otherContacted };

  // Canvass contacts: conversations for 10 voters no earlier suite touches
  // (indexes 100–109; suites m2–m7 only reach the first ~25 M1 voters).
  for (let i = 100; i < 110; i++) {
    const id = randomUUID();
    await service.from("conversations").insert({
      id,
      campaign_id: campaignA,
      canvasser_id: canvasserId,
      voter_id: seededVoterIds[i],
      voter_id_manual: true,
      audio_path: `m8-canvass/${id}.m4a`, // teardown marker (no object exists)
      recorded_at: new Date().toISOString(),
      contact_result: "full_conversation",
      status: "captured",
    });
  }
  // Other-method contacts for 5 different untouched voters (phone bank).
  await service.from("contact_log").insert(
    seededVoterIds.slice(120, 125).map((voterId) => ({
      campaign_id: campaignA,
      voter_id: voterId,
      method: "phone",
      source: "m8-test phone bank",
    })),
  );
});

test("election classification: presidential vs midterm cycles", () => {
  assert.equal(classifyElection("2024_general")!.cycle, "presidential");
  assert.equal(classifyElection("2022_general")!.cycle, "midterm");
  assert.equal(classifyElection("2026_general")!.cycle, "midterm");
  assert.equal(classifyElection("2023_general")!.cycle, "other");
  assert.equal(classifyElection("garbage"), null);
});

test("district stats: registration, exact turnout, last similar cycle", async () => {
  const stats = await fetchDistrictStats(manager, 2026);

  const { count: registered } = await service
    .from("voters")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignA);
  assert.equal(stats.registered, registered, "registered = campaign voter count");

  const t2024 = stats.turnout.find((t) => t.election === "2024_general");
  const t2022 = stats.turnout.find((t) => t.election === "2022_general");
  assert.equal(t2024!.voted, VOTED_2024, "2024 turnout count exact");
  assert.equal(t2022!.voted, VOTED_2022, "2022 turnout count exact");
  assert.ok(Math.abs(t2024!.pct - (VOTED_2024 / stats.registered) * 100) < 1e-9);

  // 2026 campaign = midterm cycle → last similar is 2022, not 2024.
  assert.equal(stats.lastSimilar!.election, "2022_general", "midterm compares to midterm");
  assert.equal(stats.lastSimilar!.cycle, "midterm");

  const expectedAvg = (t2024!.pct + t2022!.pct) / 2;
  assert.ok(Math.abs(stats.avgTurnoutPct! - expectedAvg) < 1e-9, "average turnout");
});

test("contact coverage: canvassed and other-method counts move by the seeded deltas", async () => {
  const stats = await fetchDistrictStats(manager, 2026);
  assert.equal(stats.canvassed - baseline.canvassed, 10, "10 newly canvassed voters");
  assert.equal(stats.otherContacted - baseline.otherContacted, 5, "5 phone contacts");
  assert.ok(stats.canvassedPct > 0 && stats.canvassedPct < 100);
});

test("map points: seeded voters appear with party + coordinates under RLS", async () => {
  const points: { voter_id: string; party: string | null; lat: number; lng: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await manager
      .from("voter_map_points")
      .select("voter_id, party, lat, lng")
      .range(from, from + 999);
    assert.ifError(error);
    points.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  assert.ok(points.length >= SEEDED, `≥${SEEDED} mapped voters (got ${points.length})`);
  // Judge only this suite's seeded grid — other suites (M10 geocoding)
  // legitimately place voters elsewhere in the district.
  const seededSet = new Set(seededVoterIds);
  const seededPoints = points.filter((p) => seededSet.has(p.voter_id));
  assert.equal(seededPoints.length, SEEDED, "every seeded voter is mapped");
  const parties = new Set(seededPoints.map((p) => p.party));
  assert.ok(parties.has("REP") && parties.has("DEM"), "party values flow through");
  assert.ok(
    seededPoints.every((p) => p.lat > 33 && p.lat < 34 && p.lng > -112 && p.lng < -111),
    "coordinates are sane",
  );
});

test("signs and events: members place them; they appear in the map views", async () => {
  const { error: signErr } = await canvasser.from("yard_signs").insert({
    campaign_id: campaignA,
    voter_id: seededVoterIds[0],
    location: "POINT(-111.85 33.40)",
    placed_by: canvasserId,
  });
  assert.ifError(signErr);

  const { error: eventErr } = await manager.from("campaign_events").insert({
    campaign_id: campaignA,
    kind: "house_meeting",
    title: "M8 kickoff house meeting",
    location: "POINT(-111.84 33.41)",
    held_at: new Date().toISOString(),
  });
  assert.ifError(eventErr);

  const { data: signs } = await manager.from("sign_map_points").select("lat, lng");
  assert.equal(signs!.length, 1);
  assert.ok(Math.abs(signs![0].lng - -111.85) < 1e-6);

  const { data: events } = await manager
    .from("event_map_points")
    .select("kind, title, lat, lng");
  assert.equal(events!.length, 1);
  assert.equal(events![0].kind, "house_meeting");
  assert.equal(events![0].title, "M8 kickoff house meeting");
});

test("isolation: campaign B sees no map data, signs, events, or contacts", async () => {
  const [voters, signs, events, contacts] = await Promise.all([
    clientB.from("voter_map_points").select("voter_id").limit(5),
    clientB.from("sign_map_points").select("sign_id"),
    clientB.from("event_map_points").select("event_id"),
    clientB.from("contact_log").select("id"),
  ]);
  assert.equal(voters.data!.length, 0);
  assert.equal(signs.data!.length, 0);
  assert.equal(events.data!.length, 0);
  assert.equal(contacts.data!.length, 0);
});
