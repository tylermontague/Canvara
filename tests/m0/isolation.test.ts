// M0 exit test (BUILD_PLAN.md §5): two campaigns seeded; a user in
// campaign A provably cannot read — or write — any row belonging to
// campaign B (voters, conversations, signals), and vice versa.
//
// Run `npm run seed:m0` first, then `npm run test:m0`.

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
} from "@canvara/db";
import { CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B } from "./fixtures.js";

const TABLES = ["voters", "conversations", "signals"] as const;
type TenantTable = (typeof TABLES)[number];

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env — required for ground truth.");
}

const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let campaignB: string;
let clientA: DbClient; // signed in as USER_A
let clientB: DbClient; // signed in as USER_B
// Known-good row ids per campaign, from ground truth, for direct-fetch probes.
const rowIds: Record<string, Partial<Record<TenantTable, string>>> = {};

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

before(async () => {
  const { data: campaigns, error } = await service
    .from("campaigns")
    .select("id, name")
    .in("name", [CAMPAIGN_A.name, CAMPAIGN_B.name]);
  if (error) throw new Error(error.message);

  const a = campaigns?.find((c) => c.name === CAMPAIGN_A.name);
  const b = campaigns?.find((c) => c.name === CAMPAIGN_B.name);
  if (!a || !b) {
    throw new Error("Test campaigns not found — run `npm run seed:m0` first.");
  }
  campaignA = a.id;
  campaignB = b.id;

  // Ground truth: both campaigns must actually contain rows in every table
  // under test, otherwise "user A sees zero rows" would be vacuous.
  for (const table of TABLES) {
    for (const [label, id] of [
      ["A", campaignA],
      ["B", campaignB],
    ] as const) {
      const { data, error: gtErr } = await service
        .from(table)
        .select("id")
        .eq("campaign_id", id);
      if (gtErr) throw new Error(`ground truth ${table}/${label}: ${gtErr.message}`);
      assert.ok(
        (data?.length ?? 0) > 0,
        `ground truth: campaign ${label} must have rows in ${table}`,
      );
      (rowIds[id] ??= {})[table] = data![0].id;
    }
  }

  clientA = await signIn(USER_A.email, USER_A.password);
  clientB = await signIn(USER_B.email, USER_B.password);
});

function isolationChecks(
  who: string,
  getClient: () => DbClient,
  own: () => string,
  other: () => string,
) {
  for (const table of TABLES) {
    test(`${who}: unfiltered SELECT on ${table} returns only own-campaign rows`, async () => {
      const { data, error } = await getClient().from(table).select("id, campaign_id");
      assert.ifError(error);
      assert.ok(data!.length > 0, `expected to see own rows in ${table}`);
      const foreign = data!.filter((r) => r.campaign_id !== own());
      assert.equal(
        foreign.length,
        0,
        `LEAK: ${who} can read ${foreign.length} row(s) in ${table} outside their campaign`,
      );
    });

    test(`${who}: SELECT ${table} filtered to the other campaign returns zero rows`, async () => {
      const { data, error } = await getClient()
        .from(table)
        .select("id")
        .eq("campaign_id", other());
      assert.ifError(error);
      assert.equal(data!.length, 0, `LEAK: ${who} read ${table} rows from the other campaign`);
    });

    test(`${who}: direct fetch of a known ${table} row id in the other campaign returns nothing`, async () => {
      const targetId = rowIds[other()][table]!;
      const { data, error } = await getClient()
        .from(table)
        .select("id")
        .eq("id", targetId)
        .maybeSingle();
      assert.ifError(error);
      assert.equal(data, null, `LEAK: ${who} fetched ${table} row ${targetId} by id`);
    });
  }

  test(`${who}: campaigns table exposes only their own campaign`, async () => {
    const { data, error } = await getClient().from("campaigns").select("id");
    assert.ifError(error);
    assert.deepEqual(
      data!.map((c) => c.id),
      [own()],
      `LEAK: ${who} can see campaigns other than their own`,
    );
  });

  test(`${who}: cannot INSERT a voter into the other campaign`, async () => {
    const { data, error } = await getClient()
      .from("voters")
      .insert({ campaign_id: other(), first_name: "Intruder", last_name: "Row" })
      .select("id");
    assert.ok(error, `LEAK: ${who} inserted a row into the other campaign's voters`);
    assert.equal(data, null);
  });

  test(`${who}: UPDATE against the other campaign's voters touches zero rows`, async () => {
    const targetId = rowIds[other()].voters!;
    const { data, error } = await getClient()
      .from("voters")
      .update({ first_name: "Tampered" })
      .eq("id", targetId)
      .select("id");
    assert.ifError(error);
    assert.equal(data!.length, 0, `LEAK: ${who} updated a voter in the other campaign`);

    // Confirm via ground truth that the row is untouched.
    const { data: check } = await service
      .from("voters")
      .select("first_name")
      .eq("id", targetId)
      .single();
    assert.notEqual(check!.first_name, "Tampered");
  });

  test(`${who}: DELETE against the other campaign's voters removes zero rows`, async () => {
    const targetId = rowIds[other()].voters!;
    const { data, error } = await getClient()
      .from("voters")
      .delete()
      .eq("id", targetId)
      .select("id");
    assert.ifError(error);
    assert.equal(data!.length, 0, `LEAK: ${who} deleted a voter in the other campaign`);

    const { data: check } = await service
      .from("voters")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    assert.ok(check, "row must still exist");
  });
}

isolationChecks(
  "user A",
  () => clientA,
  () => campaignA,
  () => campaignB,
);
isolationChecks(
  "user B",
  () => clientB,
  () => campaignB,
  () => campaignA,
);

test("anonymous client (no sign-in) reads zero rows everywhere", async () => {
  const anon = createAnonClient(url, anonKey);
  for (const table of [...TABLES, "campaigns"] as const) {
    const { data, error } = await anon.from(table).select("id");
    assert.ifError(error);
    assert.equal(data!.length, 0, `LEAK: anonymous client can read ${table}`);
  }
});
