// M10 exit test: voter geocoding.
//  - pure CSV build/parse against the documented Census batch format
//  - a live sweep resolves real Arizona addresses to coordinates and
//    marks a bogus address unmatched (attempted exactly once)
//  - the candidate scan only ever surfaces never-attempted voters
//
// Run after m0/m1 (needs campaign A). Makes ONE real request to the free
// Census Bureau geocoder.

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
} from "@canvara/db";
import { buildCensusBatchCsv, parseCensusBatchResponse } from "@canvara/shared";
import { runGeocodeSweep, fetchGeocodeCandidates } from "@canvara/worker/geocode";
import { CAMPAIGN_A, USER_B } from "../m0/fixtures";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const PREFIX = "M10-";

// Two real, stable Arizona addresses and one that cannot exist.
const SEEDS = [
  { external_id: `${PREFIX}CITYHALL`, address: "20 E Main St", city: "Mesa", zip: "85201", real: true },
  { external_id: `${PREFIX}CAPITOL`, address: "1700 W Washington St", city: "Phoenix", zip: "85007", real: true },
  { external_id: `${PREFIX}BOGUS`, address: "9999 Nowhere Rd", city: "Nowheresville", zip: "00000", real: false },
];

let campaignA: string;
let seededIds: string[] = [];
let clientB: DbClient;

before(async () => {
  const { data: campaign } = await service
    .from("campaigns")
    .select("id, state")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;
  assert.ok(campaign.state, "campaign A has a state (the geocoder requires it)");

  // Teardown prior M10 voters.
  const { error: tearErr } = await service
    .from("voters")
    .delete()
    .eq("campaign_id", campaignA)
    .like("external_id", `${PREFIX}%`);
  if (tearErr) throw new Error(`teardown: ${tearErr.message}`);

  const { data: inserted, error: insErr } = await service
    .from("voters")
    .insert(
      SEEDS.map((s) => ({
        campaign_id: campaignA,
        external_id: s.external_id,
        first_name: "M10",
        last_name: "Test",
        address: s.address,
        city: s.city,
        zip: s.zip,
      })),
    )
    .select("id, external_id");
  if (insErr) throw new Error(`seed: ${insErr.message}`);
  seededIds = inserted!.map((v) => v.id);

  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: USER_B.email,
    password: USER_B.password,
  });
  if (error) throw new Error(`sign-in B: ${error.message}`);
  clientB = client;
});

test("batch CSV: quoting survives commas, quotes, and newlines in addresses", () => {
  const csv = buildCensusBatchCsv([
    { id: "a1", address: '123 "Oak" Ln, Apt 4', city: "Mesa\nAZ", state: "AZ", zip: "85201" },
  ]);
  assert.equal(csv, '"a1","123 ""Oak"" Ln, Apt 4","Mesa AZ","AZ","85201"');
});

test("batch response parse: Match, Non_Exact, No_Match, and Tie rows", () => {
  const text = [
    '"a1","20 E Main St, Mesa, AZ, 85201","Match","Exact","20 E MAIN ST, MESA, AZ, 85201","-111.830941843968,33.4151548194","647698007","L"',
    '"a2","1 Somewhere Ave, Mesa, AZ, 85201","Match","Non_Exact","1 SOMEWHERE AVE, MESA, AZ, 85201","-111.5,33.5","1","R"',
    '"a3","9999 Nowhere Rd, Nowheresville, , 00000","No_Match"',
    '"a4","2 Ambiguous St, Mesa, AZ, 85201","Tie"',
  ].join("\n");
  const parsed = parseCensusBatchResponse(text);
  assert.deepEqual(parsed.get("a1"), { lat: 33.4151548194, lng: -111.830941843968 });
  assert.deepEqual(parsed.get("a2"), { lat: 33.5, lng: -111.5 });
  assert.equal(parsed.get("a3"), null);
  assert.equal(parsed.get("a4"), null);
  assert.equal(parsed.size, 4);
});

test("live sweep: real addresses gain coordinates, the bogus one is retired", async () => {
  const stats = await runGeocodeSweep(service, { voterIds: seededIds });
  assert.equal(stats.examined, 3, "all three seeded voters attempted");
  assert.equal(stats.matched, 2, "both real addresses matched");
  assert.equal(stats.unmatched, 1, "the bogus address recorded as unmatched");
  assert.deepEqual(stats.errors, []);

  // Read back through the map view — the same path the console uses —
  // so this also proves the dots would actually appear.
  const { data: voters } = await service
    .from("voters")
    .select("external_id, geocode_status, geocoded_at, location")
    .in("id", seededIds);
  const byExt = new Map(voters!.map((v) => [v.external_id, v]));

  for (const seed of SEEDS) {
    const row = byExt.get(seed.external_id)!;
    assert.equal(row.geocode_status, seed.real ? "matched" : "unmatched", seed.external_id);
    assert.ok(row.geocoded_at, "attempt timestamped");
    assert.equal(row.location !== null, seed.real, "location only for matches");
  }

  const { data: points } = await service
    .from("voter_map_points")
    .select("lat, lng, voter_id")
    .in("voter_id", seededIds);
  assert.equal(points!.length, 2, "both matches reach the map view");
  for (const p of points!) {
    assert.ok(p.lat > 33 && p.lat < 34 && p.lng > -113 && p.lng < -111, "Arizona coordinates");
  }
});

test("attempted exactly once: a repeat sweep finds nothing to do", async () => {
  const stats = await runGeocodeSweep(service, { voterIds: seededIds });
  assert.equal(stats.examined, 0, "matched and unmatched voters are both retired");
});

test("candidate scan: only never-attempted voters with addresses", async () => {
  const candidates = await fetchGeocodeCandidates(service, 50);
  const ids = new Set(candidates.map((c) => c.id));
  for (const id of seededIds) {
    assert.ok(!ids.has(id), "processed M10 voters are no longer candidates");
  }
  for (const c of candidates) {
    assert.ok(c.address, "every candidate has an address to try");
  }
});

test("isolation: campaign B cannot see the geocoded voters", async () => {
  const { data } = await clientB
    .from("voters")
    .select("id")
    .like("external_id", `${PREFIX}%`);
  assert.equal(data!.length, 0);
});
