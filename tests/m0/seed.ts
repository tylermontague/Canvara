// M0 exit-test seed: two campaigns, one user each, plus rows in
// voters / conversations / signals for both campaigns.
// Idempotent — re-running tears down and recreates the test data.
//
// Usage: npm run seed:m0   (requires .env with SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY at the repo root)

import "dotenv/config";
import { createServiceClient, supabaseEnv, type DbClient } from "@canvara/db";
import { CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B } from "./fixtures";

const { url, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env — required to seed.");
}
const db = createServiceClient(url, serviceRoleKey);

function assertOk<T>(
  result: { data: T; error: { message: string } | null },
  ctx: string,
): NonNullable<T> {
  if (result.error) throw new Error(`${ctx}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${ctx}: no data returned`);
  return result.data;
}

async function teardown(db: DbClient) {
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id")
    .in("name", [CAMPAIGN_A.name, CAMPAIGN_B.name]);
  const ids = (campaigns ?? []).map((c) => c.id);

  if (ids.length > 0) {
    // FK dependency order (no cascades from campaigns).
    for (const table of [
      "signals",
      "review_queue",
      "belief_states",
      "conversations",
      "walk_list_items",
      "walk_lists",
      "shifts",
      "audit_log",
      "voters",
      "profiles",
    ] as const) {
      const { error } = await db.from(table).delete().in("campaign_id", ids);
      if (error) throw new Error(`teardown ${table}: ${error.message}`);
    }
  }

  // Remove the auth users (page through; test project stays small).
  const { data: userList, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw new Error(`teardown listUsers: ${listErr.message}`);
  for (const u of userList.users) {
    if (u.email === USER_A.email || u.email === USER_B.email) {
      const { error } = await db.auth.admin.deleteUser(u.id);
      if (error) throw new Error(`teardown deleteUser ${u.email}: ${error.message}`);
    }
  }

  if (ids.length > 0) {
    const { error } = await db.from("campaigns").delete().in("id", ids);
    if (error) throw new Error(`teardown campaigns: ${error.message}`);
  }
}

async function seedCampaign(
  db: DbClient,
  campaign: typeof CAMPAIGN_A,
  user: typeof USER_A,
  suffix: "A" | "B",
) {
  const c = assertOk(
    await db.from("campaigns").insert(campaign).select("id, name").single(),
    `insert campaign ${suffix}`,
  );

  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser ${user.email}: ${userErr.message}`);
  const userId = created.user.id;

  assertOk(
    await db
      .from("profiles")
      .insert({
        id: userId,
        campaign_id: c.id,
        role: user.role,
        full_name: user.fullName,
      })
      .select("id")
      .single(),
    `insert profile ${suffix}`,
  );

  const voters = assertOk(
    await db
      .from("voters")
      .insert([
        {
          campaign_id: c.id,
          first_name: `Alice-${suffix}`,
          last_name: "Voter",
          city: "Testville",
          precinct: `P-${suffix}1`,
        },
        {
          campaign_id: c.id,
          first_name: `Bob-${suffix}`,
          last_name: "Voter",
          city: "Testville",
          precinct: `P-${suffix}2`,
        },
      ])
      .select("id"),
    `insert voters ${suffix}`,
  );

  const conversation = assertOk(
    await db
      .from("conversations")
      .insert({
        campaign_id: c.id,
        canvasser_id: userId,
        voter_id: voters[0].id,
        recorded_at: new Date().toISOString(),
        status: "extracted",
        contact_result: "full_conversation",
      })
      .select("id")
      .single(),
    `insert conversation ${suffix}`,
  );

  assertOk(
    await db
      .from("signals")
      .insert({
        campaign_id: c.id,
        conversation_id: conversation.id,
        support_level: "undecided",
        top_issues: ["property_taxes"],
        confidence_score: 0.9,
        model_used: "seed-script",
        prompt_version: "m0-seed",
      })
      .select("id")
      .single(),
    `insert signal ${suffix}`,
  );

  return { campaignId: c.id, userId };
}

async function main() {
  console.log("Tearing down any previous M0 test data…");
  await teardown(db);

  console.log("Seeding campaign A…");
  const a = await seedCampaign(db, CAMPAIGN_A, USER_A, "A");
  console.log("Seeding campaign B…");
  const b = await seedCampaign(db, CAMPAIGN_B, USER_B, "B");

  console.log("\nSeed complete:");
  console.log(`  Campaign A (${CAMPAIGN_A.name}): ${a.campaignId} — user ${USER_A.email}`);
  console.log(`  Campaign B (${CAMPAIGN_B.name}): ${b.campaignId} — user ${USER_B.email}`);
  console.log("\nRun the exit test with: npm run test:m0");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
