// M14 exit test: the voter data portal's core promise — re-importing a
// voter file MERGES and never destroys what the field learned.
//
// Scenario: import 4 voters, richly canvass one of them (door-observed
// attribute, belief state, a signal with personal context, a survey
// answer, geocoded coordinates), then re-import a file that changes that
// voter's address + party, keeps two unchanged, drops one, and adds a new
// one. Assert:
//   - file columns update (new address, new party)
//   - EVERY derived datum survives untouched
//   - geocode resets only where the address changed (worker re-geocodes),
//     and is preserved where it didn't
//   - a dropped voter goes inactive, is NOT deleted, keeps its history
//   - a returning voter reactivates
//   - import provenance counts are exact; campaign B is untouched
//
// Run after m0 (needs campaigns A/B and their users).

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
  planVoterImport,
  applyVoterImport,
  type MappedVoter,
  type ExistingVoterRow,
} from "@canvara/shared";
import { CAMPAIGN_A, USER_B } from "../m0/fixtures";
import { ensureCanvasser } from "../helpers";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

const P = "M14-"; // external_id prefix

function voter(n: number, over: Partial<MappedVoter> = {}): MappedVoter {
  return {
    external_id: `${P}${String(n).padStart(4, "0")}`,
    first_name: `First${n}`,
    last_name: `Last${n}`,
    address: `${100 + n} N Main St`,
    city: "MESA",
    zip: "85201",
    precinct: "PCT-011",
    party: "IND",
    birth_year: 1970,
    gender: "F",
    race: null,
    income_bracket: null,
    education: null,
    religion: null,
    ...over,
  };
}

let campaignA: string;
let canvasserId: string;
let clientB: DbClient;
let v1Id: string;
let v4Id: string;

async function idFor(ext: string): Promise<string | null> {
  const { data } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .eq("external_id", ext)
    .maybeSingle();
  return data?.id ?? null;
}

before(async () => {
  const { data: camp } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!camp) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = camp.id;
  canvasserId = await ensureCanvasser(service, campaignA);

  // Teardown prior M14 artifacts. Conversations cascade signals/survey
  // responses; clear review_queue (no cascade) first, then conversations,
  // then voters (cascades attributes + beliefs), then imports + questions.
  const { data: oldVoters } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("external_id", `${P}%`);
  const oldIds = (oldVoters ?? []).map((v) => v.id);
  if (oldIds.length > 0) {
    const { data: convos } = await service
      .from("conversations")
      .select("id")
      .in("voter_id", oldIds);
    const convoIds = (convos ?? []).map((c) => c.id);
    if (convoIds.length > 0) {
      await service.from("review_queue").delete().in("conversation_id", convoIds);
      await service.from("conversations").delete().in("id", convoIds);
    }
    await service.from("belief_states").delete().in("voter_id", oldIds);
    await service.from("voter_attributes").delete().in("voter_id", oldIds);
    await service.from("voters").delete().in("id", oldIds);
  }
  await service.from("survey_questions").delete().eq("campaign_id", campaignA).like("question", `${P}%`);
  await service.from("imports").delete().eq("campaign_id", campaignA).like("source_label", `${P}%`);

  clientB = createAnonClient(url, anonKey);
  const { error } = await clientB.auth.signInWithPassword({
    email: USER_B.email,
    password: USER_B.password,
  });
  if (error) throw new Error(`sign-in B: ${error.message}`);
});

// ---------- Pure planner ----------

test("planVoterImport classifies insert / update / drop / reactivate / unmergeable exactly", () => {
  const existing: ExistingVoterRow[] = [
    { external_id: `${P}0001`, address: "100 old st", active: true, portalManaged: true },
    { external_id: `${P}0002`, address: "200 same st", active: true, portalManaged: true },
    { external_id: `${P}0004`, address: "400 gone st", active: true, portalManaged: true }, // drops
    { external_id: `${P}0009`, address: "900 back st", active: false, portalManaged: true }, // returns
  ];
  const incoming: MappedVoter[] = [
    voter(1, { address: "100 NEW st" }), // update + address changed
    voter(2, { address: "200 same st" }), // update, address same
    voter(5), // insert
    voter(9, { address: "900 back st" }), // reactivate
    voter(0, { external_id: null }), // unmergeable
  ];
  const plan = planVoterImport(existing, incoming, { deactivateAbsent: true });

  assert.deepEqual(plan.toInsert.map((v) => v.external_id), [`${P}0005`]);
  assert.deepEqual(plan.addressChanged, [`${P}0001`]);
  assert.deepEqual(plan.toReactivate, [`${P}0009`]);
  assert.deepEqual(plan.toDeactivate, [`${P}0004`]);
  assert.equal(plan.unmergeable.length, 1);
  assert.deepEqual(plan.counts, {
    inserted: 1,
    updated: 3, // 0001, 0002, 0009
    unchanged: 2, // updated minus the one address change
    dropped: 1,
    reactivated: 1,
    unmergeable: 1,
  });
});

// ---------- Live merge with real field intelligence ----------

test("first import inserts the initial universe", async () => {
  const result = await applyVoterImport(
    service,
    [voter(1), voter(2), voter(3), voter(4)],
    { campaignId: campaignA, actorId: null, sourceLabel: `${P}initial` },
  );
  assert.equal(result.counts.inserted, 4);
  // Safe default: a partial import with deactivateAbsent off never retires
  // the campaign's other voters (the ~5,000 M1 voters stay active).
  assert.equal(result.counts.dropped, 0);
  const { count: activeM1 } = await service
    .from("voters")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignA)
    .like("external_id", "M1-%")
    .eq("active", true);
  assert.ok((activeM1 ?? 0) > 100, "unrelated voters remain active after a partial import");

  v1Id = (await idFor(`${P}0001`))!;
  v4Id = (await idFor(`${P}0004`))!;
  assert.ok(v1Id && v4Id, "voters landed");
});

test("canvass voter 1 richly, and geocode voters 1 and 2", async () => {
  // Door-observed attribute (the file says nothing; the canvasser learned).
  await service.from("voter_attributes").insert({
    campaign_id: campaignA,
    voter_id: v1Id,
    key: "race",
    value: "hispanic",
    source: "canvasser",
  });
  // A belief state.
  await service.from("belief_states").insert({
    campaign_id: campaignA,
    voter_id: v1Id,
    issue_id: "property_taxes",
    alpha: 4,
    beta: 2,
  });
  // A conversation + signal carrying personal context (survives retention).
  const convoId = randomUUID();
  const { error: convErr } = await service.from("conversations").insert({
    id: convoId,
    campaign_id: campaignA,
    canvasser_id: canvasserId,
    voter_id: v1Id,
    voter_id_manual: true,
    audio_path: `${P}conv/${convoId}.m4a`,
    recorded_at: new Date().toISOString(),
    contact_result: "full_conversation",
    status: "extracted",
  });
  assert.ifError(convErr);
  const { error: sigErr } = await service.from("signals").insert({
    campaign_id: campaignA,
    conversation_id: convoId,
    support_level: "lean_support",
    top_issues: ["property_taxes", "water"],
    personal_context: ["retired shop teacher", "two grandkids at Marcos de Niza"],
    confidence_score: 0.9,
    model_used: "m14-seed",
    prompt_version: "m14-seed",
    issue_sentiment: {} as Json,
    provenance: {} as Json,
  });
  assert.ifError(sigErr);
  // A door-poll answer.
  const { data: q } = await service
    .from("survey_questions")
    .insert({
      campaign_id: campaignA,
      question: `${P}Bond measure?`,
      options: ["yes", "no"],
      kind: "choice",
    })
    .select("id")
    .single();
  await service.from("survey_responses").insert({
    campaign_id: campaignA,
    question_id: q!.id,
    conversation_id: convoId,
    voter_id: v1Id,
    answer: "yes",
    phase: "only",
  });
  // Geocode voters 1 and 2 (as the worker would).
  for (const ext of [`${P}0001`, `${P}0002`]) {
    const id = await idFor(ext);
    await service
      .from("voters")
      .update({
        location: "POINT(-111.83 33.42)",
        geocode_status: "matched",
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", id!);
  }
});

test("RE-IMPORT: file columns update, address change resets geocode", async () => {
  // New file: v1 moved + switched party, v2/v3 unchanged, v4 dropped,
  // v5 new, plus a row with no ID (unmergeable).
  const result = await applyVoterImport(
    service,
    [
      voter(1, { address: "999 W Broadway Rd", party: "DEM" }),
      voter(2),
      voter(3),
      voter(5),
      voter(0, { external_id: null }),
    ],
    { campaignId: campaignA, actorId: null, sourceLabel: `${P}reimport`, deactivateAbsent: true },
  );

  assert.deepEqual(
    result.counts,
    { inserted: 1, updated: 3, unchanged: 2, dropped: 1, reactivated: 0, unmergeable: 1 },
    "exact merge counts",
  );

  // File columns updated on voter 1.
  const { data: v1 } = await service
    .from("voters")
    .select("address, party, active, location, geocode_status, geocoded_at")
    .eq("id", v1Id)
    .single();
  assert.equal(v1!.address, "999 W Broadway Rd", "address updated");
  assert.equal(v1!.party, "DEM", "party updated");
  assert.equal(v1!.active, true);
  // Address changed → geocode reset so the worker re-geocodes.
  assert.equal(v1!.location, null, "geocode cleared on address change");
  assert.equal(v1!.geocode_status, null);
  assert.equal(v1!.geocoded_at, null);
});

test("PRESERVED: every scrap of field intelligence survives the re-import", async () => {
  // Door-observed attribute.
  const { data: attrs } = await service
    .from("voter_attributes")
    .select("key, value, source")
    .eq("voter_id", v1Id);
  assert.equal(attrs!.length, 1);
  assert.deepEqual(attrs![0], { key: "race", value: "hispanic", source: "canvasser" });

  // Belief state.
  const { data: belief } = await service
    .from("belief_states")
    .select("alpha, beta")
    .eq("voter_id", v1Id)
    .eq("issue_id", "property_taxes")
    .single();
  assert.deepEqual(belief, { alpha: 4, beta: 2 });

  // Signal + personal context (via voter 1's conversation).
  const { data: convo } = await service
    .from("conversations")
    .select("id")
    .eq("voter_id", v1Id)
    .single();
  const { data: sig } = await service
    .from("signals")
    .select("support_level, top_issues, personal_context")
    .eq("conversation_id", convo!.id)
    .single();
  assert.equal(sig!.support_level, "lean_support");
  assert.deepEqual(sig!.top_issues, ["property_taxes", "water"]);
  assert.deepEqual(sig!.personal_context, [
    "retired shop teacher",
    "two grandkids at Marcos de Niza",
  ]);

  // Survey answer.
  const { count: answers } = await service
    .from("survey_responses")
    .select("id", { count: "exact", head: true })
    .eq("voter_id", v1Id);
  assert.equal(answers, 1);
});

test("PRESERVED: an unchanged address keeps its coordinates", async () => {
  const id = await idFor(`${P}0002`);
  const { data: v2 } = await service
    .from("voters")
    .select("location, geocode_status")
    .eq("id", id!)
    .single();
  assert.notEqual(v2!.location, null, "voter 2's coordinates survive (address unchanged)");
  assert.equal(v2!.geocode_status, "matched");
});

test("DROPPED voter goes inactive, is not deleted, keeps its history", async () => {
  const { data: v4 } = await service
    .from("voters")
    .select("id, active, dropped_from_file_at")
    .eq("id", v4Id)
    .single();
  assert.equal(v4!.active, false, "dropped voter deactivated");
  assert.ok(v4!.dropped_from_file_at, "drop timestamp recorded");
  // The new voter is present and active.
  const v5 = await idFor(`${P}0005`);
  assert.ok(v5, "new voter inserted");
});

test("REACTIVATION: a returning voter comes back active", async () => {
  const result = await applyVoterImport(
    service,
    [voter(1), voter(2), voter(3), voter(4), voter(5)], // v4 returns
    { campaignId: campaignA, actorId: null, sourceLabel: `${P}reactivate`, deactivateAbsent: true },
  );
  assert.equal(result.counts.reactivated, 1);
  const { data: v4 } = await service
    .from("voters")
    .select("active, dropped_from_file_at")
    .eq("id", v4Id)
    .single();
  assert.equal(v4!.active, true, "voter 4 reactivated");
  assert.equal(v4!.dropped_from_file_at, null, "drop timestamp cleared");
});

test("import provenance is recorded and campaign B sees none of it", async () => {
  const { data: imps } = await service
    .from("imports")
    .select("source_label, inserted_count, dropped_count")
    .eq("campaign_id", campaignA)
    .like("source_label", `${P}%`)
    .order("created_at");
  assert.equal(imps!.length, 3, "three imports recorded");
  assert.equal(imps![0].source_label, `${P}initial`);
  assert.equal(imps![0].inserted_count, 4);

  const [bImports, bVoters] = await Promise.all([
    clientB.from("imports").select("id").like("source_label", `${P}%`),
    clientB.from("voters").select("id").like("external_id", `${P}%`),
  ]);
  assert.equal(bImports.data!.length, 0, "campaign B sees no M14 imports");
  assert.equal(bVoters.data!.length, 0, "campaign B sees no M14 voters");
});
