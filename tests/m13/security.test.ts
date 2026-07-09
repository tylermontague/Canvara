// Security hardening exit test (certification): proves the controls added
// in migration 14 + the worker log sanitizer actually hold against the
// database, not just in review.
//  - audit_log is append-only: a member may read + insert but CANNOT
//    update or delete entries (tamper-evidence)
//  - the tenancy functions still resolve after search_path pinning (RLS
//    would silently deny everything if they broke)
//  - cross-tenant audit access is denied
//  - correlate_voter still works with the pinned search_path
//  - sanitizeForLog neutralizes newline/control-char log injection
//
// Run after m0 (needs campaigns A/B and their users) and m1 (voters).

import "dotenv/config";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAnonClient,
  createServiceClient,
  supabaseEnv,
  type DbClient,
} from "@canvara/db";
import { sanitizeForLog } from "@canvara/worker/log";
import { CAMPAIGN_A, USER_A, USER_B } from "../m0/fixtures";

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let campaignB: string;
let userA: DbClient;
let userB: DbClient;
let seededAuditId: number;

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

before(async () => {
  const { data: a } = await service
    .from("campaigns")
    .select("id")
    .eq("name", CAMPAIGN_A.name)
    .maybeSingle();
  if (!a) throw new Error("Campaign A not found — run `npm run seed:m0` first.");
  campaignA = a.id;
  const { data: b } = await service
    .from("campaigns")
    .select("id")
    .neq("id", campaignA)
    .limit(1)
    .maybeSingle();
  campaignB = b!.id;

  userA = await signIn(USER_A.email, USER_A.password);
  userB = await signIn(USER_B.email, USER_B.password);

  // A pre-existing audit row (as the worker/service would write) to attempt
  // to tamper with.
  const { data, error } = await service
    .from("audit_log")
    .insert({
      campaign_id: campaignA,
      action: "m13_seed",
      entity: "test",
      entity_id: randomUUID(),
      detail: { seeded: true },
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed audit: ${error.message}`);
  seededAuditId = data.id;
});

test("tenancy functions still resolve after search_path pinning", async () => {
  // If current_campaign_id() broke, RLS would deny everything — a plain
  // authenticated read returning the user's own campaign proves it works.
  const { data, error } = await userA.from("campaigns").select("id");
  assert.ifError(error);
  assert.equal(data!.length, 1, "user A sees exactly their campaign");
  assert.equal(data![0].id, campaignA);
});

test("audit_log is readable and insertable by a member", async () => {
  const { error: insErr } = await userA.from("audit_log").insert({
    campaign_id: campaignA,
    action: "m13_member_insert",
    entity: "test",
    entity_id: randomUUID(),
    detail: { by: "member" },
  });
  assert.ifError(insErr); // debrief/settings/message flows depend on this

  const { data, error } = await userA
    .from("audit_log")
    .select("id, action")
    .eq("campaign_id", campaignA)
    .limit(5);
  assert.ifError(error);
  assert.ok(data!.length > 0, "member can read the trail");
});

test("audit_log is APPEND-ONLY: update and delete are denied", async () => {
  // RLS has no UPDATE/DELETE policy → both must affect zero rows (not error,
  // just silently match nothing), and the row must be unchanged.
  const { data: updated, error: updErr } = await userA
    .from("audit_log")
    .update({ action: "TAMPERED" })
    .eq("id", seededAuditId)
    .select("id");
  assert.ifError(updErr);
  assert.equal(updated!.length, 0, "UPDATE touched zero rows");

  const { data: deleted, error: delErr } = await userA
    .from("audit_log")
    .delete()
    .eq("id", seededAuditId)
    .select("id");
  assert.ifError(delErr);
  assert.equal(deleted!.length, 0, "DELETE touched zero rows");

  // Ground truth: the entry is intact and unmodified.
  const { data: row } = await service
    .from("audit_log")
    .select("action")
    .eq("id", seededAuditId)
    .single();
  assert.equal(row!.action, "m13_seed", "the audit entry is untouched");
});

test("cross-tenant: campaign B cannot read or tamper with A's audit trail", async () => {
  const { data: read } = await userB
    .from("audit_log")
    .select("id")
    .eq("id", seededAuditId);
  assert.equal(read!.length, 0, "B cannot see A's audit rows");

  const { data: upd } = await userB
    .from("audit_log")
    .update({ action: "B_TAMPER" })
    .eq("id", seededAuditId)
    .select("id");
  assert.equal(upd!.length, 0, "B cannot update A's audit rows");

  // B cannot forge an entry into A's campaign either (WITH CHECK).
  const { error: forgeErr } = await userB.from("audit_log").insert({
    campaign_id: campaignA,
    action: "forged",
    entity: "test",
    entity_id: randomUUID(),
    detail: {},
  });
  assert.ok(forgeErr, "cross-tenant audit insert rejected by WITH CHECK");
});

test("correlate_voter still resolves under the pinned search_path", async () => {
  // Call the hardened SECURITY function directly (service role). It must
  // execute without a schema-resolution error; an empty result is fine —
  // we only assert PostGIS operators still resolve.
  const { error } = await service.rpc("correlate_voter", {
    p_campaign_id: campaignA,
    p_lat: 33.4,
    p_lng: -111.85,
    p_max_meters: 50,
  });
  assert.ifError(error);
});

test("sanitizeForLog neutralizes log-injection payloads", () => {
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);

  const forged = `real error${CR}${LF}2026-01-01 INFO admin: access granted`;
  const cleaned = sanitizeForLog(forged);
  assert.ok(!cleaned.includes(CR) && !cleaned.includes(LF), "no CR/LF survives");
  assert.ok(cleaned.startsWith("real error "), "content preserved, newline → space");

  assert.equal(sanitizeForLog(`a${NUL}b${BEL}c`), "abc", "control chars stripped");
  assert.equal(sanitizeForLog(new Error("boom")), "boom", "unwraps Error.message");
  assert.equal(sanitizeForLog("x".repeat(500)).length, 301, "bounded length + ellipsis");
  assert.equal(sanitizeForLog(null), "", "null-safe");
});
