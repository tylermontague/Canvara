// M1 exit test (BUILD_PLAN.md §5): import a 5k-row test voter file, then
// build and assign a walk list — all through the same shared code paths the
// console uses, as the campaign-A user under RLS. Verifies mapping fidelity,
// import counts, stop ordering, assignment, and that campaign B sees none
// of it.
//
// Prereq: M0 seed (`npm run seed:m0`) so campaigns A/B and their users exist.
// Run with: npm run test:m1

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
  type TablesInsert,
} from "@canvara/db";
import {
  parseCsv,
  detectHeaderRow,
  suggestMapping,
  mapRows,
  orderStops,
  type MappedVoter,
  type ColumnMapping,
} from "@canvara/shared";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";
import { generateVoterFileCsv, M1_EXTERNAL_ID_PREFIX } from "./gen-voter-file";

const ROW_COUNT = 5000;
const BATCH_SIZE = 500;
const WALK_LIST_NAME = "M1 Test Walk List — Mesa 85203";
const CANVASSER = {
  email: "m1-canvasser-a@canvara-test.dev",
  password: "m1-test-canvasser-8k4p",
  fullName: "M1 Canvasser A",
};

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
}
const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let clientA: DbClient;
let clientB: DbClient;
let canvasserProfileId: string;
let csvText: string;

// Populated by the earlier tests, consumed by the later ones (node:test
// runs tests in this file sequentially).
let mapping: ColumnMapping;
let mappedVoters: MappedVoter[];
let walkListId: string;

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

before(async () => {
  // Campaign A must exist (M0 seed).
  const { data: campaign } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = campaign.id;

  // Teardown previous M1 artifacts (idempotent re-runs).
  const { data: oldLists } = await service
    .from("walk_lists")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("name", "M1 %");
  for (const l of oldLists ?? []) {
    await service.from("walk_list_items").delete().eq("walk_list_id", l.id);
    await service.from("walk_lists").delete().eq("id", l.id);
  }
  {
    const { error } = await service
      .from("voters")
      .delete()
      .eq("campaign_id", campaignA)
      .like("external_id", `${M1_EXTERNAL_ID_PREFIX}%`);
    if (error) throw new Error(`teardown voters: ${error.message}`);
  }

  // Ensure a canvasser exists in campaign A to assign the walk list to.
  const { data: userList, error: listErr } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw new Error(listErr.message);
  let canvasserUserId = userList.users.find((u) => u.email === CANVASSER.email)?.id;
  if (!canvasserUserId) {
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: CANVASSER.email,
      password: CANVASSER.password,
      email_confirm: true,
    });
    if (createErr) throw new Error(createErr.message);
    canvasserUserId = created.user.id;
  }
  const { data: profile } = await service
    .from("profiles")
    .select("id")
    .eq("id", canvasserUserId)
    .maybeSingle();
  if (!profile) {
    const { error: profErr } = await service.from("profiles").insert({
      id: canvasserUserId,
      campaign_id: campaignA,
      role: "canvasser",
      full_name: CANVASSER.fullName,
    });
    if (profErr) throw new Error(profErr.message);
  }
  canvasserProfileId = canvasserUserId;

  // Generate the 5k-row file on disk and read it back, like a real upload.
  const dir = mkdtempSync(path.join(tmpdir(), "canvara-m1-"));
  const filePath = path.join(dir, "voter-file-5k.csv");
  writeFileSync(filePath, generateVoterFileCsv(ROW_COUNT));
  csvText = readFileSync(filePath, "utf8");

  clientA = await signIn(USER_A.email, USER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
});

test("parse: header detected below the preamble; all 10 fields auto-mapped", () => {
  const rows = parseCsv(csvText);
  // The all-empty preamble line is dropped by parsing; 2 disclaimer lines +
  // 2 header rows survive above the data.
  assert.equal(rows.length, ROW_COUNT + 4, "disclaimers + split header + data rows");

  const headerIndex = detectHeaderRow(rows);
  assert.equal(rows[headerIndex][2], "Voter ID", "detected the real header row");

  mapping = suggestMapping(rows[headerIndex]);
  for (const field of [
    "external_id",
    "first_name",
    "last_name",
    "address",
    "city",
    "zip",
    "precinct",
    "party",
    "birth_year",
    "gender",
  ] as const) {
    assert.ok(mapping[field], `field ${field} auto-mapped`);
  }
  // Mailing decoy columns (14–16) must not be mapped anywhere.
  const usedColumns = Object.values(mapping).flat();
  for (const decoy of [14, 15, 16]) {
    assert.ok(!usedColumns.includes(decoy), `mailing decoy column ${decoy} not mapped`);
  }

  const result = mapRows(rows, headerIndex, mapping);
  assert.equal(result.voters.length, ROW_COUNT, "all 5,000 rows mapped");
  assert.equal(result.skipped, 0);

  const first = result.voters[0];
  assert.equal(first.external_id, `${M1_EXTERNAL_ID_PREFIX}00001`);
  assert.match(first.address ?? "", /^\d+ [NSEW] /, "address composed as Num Dir Street");
  assert.ok(first.birth_year && first.birth_year >= 1935, "birth year parsed as number");

  mappedVoters = result.voters;
});

test("import: campaign-A user inserts all 5,000 voters under RLS", async () => {
  const rows: TablesInsert<"voters">[] = mappedVoters.map((v) => ({
    ...v,
    campaign_id: campaignA,
  }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await clientA.from("voters").insert(rows.slice(i, i + BATCH_SIZE));
    assert.ifError(error);
  }

  const { count } = await clientA
    .from("voters")
    .select("id", { count: "exact", head: true })
    .like("external_id", `${M1_EXTERNAL_ID_PREFIX}%`);
  assert.equal(count, ROW_COUNT, "campaign-A user sees all imported voters");

  // Ground truth: they all landed in campaign A.
  const { count: gtCount } = await service
    .from("voters")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignA)
    .like("external_id", `${M1_EXTERNAL_ID_PREFIX}%`);
  assert.equal(gtCount, ROW_COUNT);
});

test("walk list: filter, order, create, and assign to a canvasser", async () => {
  // Filter: one turf — Mesa, ZIP 85203 (same filters the builder UI applies).
  const { data: turf, error: turfErr } = await clientA
    .from("voters")
    .select("id, first_name, last_name, address, city, zip")
    .like("external_id", `${M1_EXTERNAL_ID_PREFIX}%`)
    .eq("city", "MESA")
    .eq("zip", "85203");
  assert.ifError(turfErr);
  assert.ok(turf!.length > 50, `turf has a real number of doors (got ${turf!.length})`);

  const ordered = orderStops(turf!);

  const { data: list, error: listErr } = await clientA
    .from("walk_lists")
    .insert({
      campaign_id: campaignA,
      name: WALK_LIST_NAME,
      assigned_to: canvasserProfileId,
    })
    .select("id")
    .single();
  assert.ifError(listErr);
  walkListId = list!.id;

  const items = ordered.map((v, i) => ({
    campaign_id: campaignA,
    walk_list_id: walkListId,
    voter_id: v.id,
    position: i + 1,
  }));
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const { error } = await clientA
      .from("walk_list_items")
      .insert(items.slice(i, i + BATCH_SIZE));
    assert.ifError(error);
  }

  // Read back what a canvasser's app would read.
  const { data: readBack, error: readErr } = await clientA
    .from("walk_lists")
    .select("name, assigned_to, profiles(full_name, role), walk_list_items(voter_id, position)")
    .eq("id", walkListId)
    .single();
  assert.ifError(readErr);
  assert.equal(readBack!.assigned_to, canvasserProfileId, "assigned to the canvasser");
  assert.equal(readBack!.profiles?.role, "canvasser");
  assert.equal(readBack!.walk_list_items.length, ordered.length, "every stop saved");

  const positions = readBack!.walk_list_items
    .map((i) => i.position)
    .sort((a, b) => a - b);
  assert.deepEqual(
    positions,
    ordered.map((_, i) => i + 1),
    "positions are exactly 1..N",
  );

  const byPosition = [...readBack!.walk_list_items].sort((a, b) => a.position - b.position);
  assert.deepEqual(
    byPosition.map((i) => i.voter_id),
    ordered.map((v) => v.id),
    "stop order matches the street-by-street ordering",
  );
});

test("isolation holds: campaign B sees no imported voters and no walk list", async () => {
  const { count: voterCount } = await clientB
    .from("voters")
    .select("id", { count: "exact", head: true })
    .like("external_id", `${M1_EXTERNAL_ID_PREFIX}%`);
  assert.equal(voterCount, 0, "campaign B cannot see any imported voter");

  const { data: lists } = await clientB.from("walk_lists").select("id").like("name", "M1 %");
  assert.equal(lists!.length, 0, "campaign B cannot see the walk list");

  const { data: items } = await clientB
    .from("walk_list_items")
    .select("id")
    .eq("walk_list_id", walkListId);
  assert.equal(items!.length, 0, "campaign B cannot see the stops");
});
