// M2 exit test (BUILD_PLAN.md §5): "airplane-mode canvass of 5 doors; all
// data syncs on reconnect."
//
// Runs the SAME sync engine the field app ships (packages/shared/offline)
// with test ports: an in-memory queue, fake recorded audio, and a network
// switch. While "offline", five door captures accumulate locally and
// nothing reaches the server. On "reconnect", the queue drains through the
// real Supabase APIs as the signed-in canvasser (RLS + storage policies
// enforced), and we verify every row, file, timestamp, and stop status —
// then prove re-syncing the same captures creates no duplicates.
//
// Prereqs: seed:m0 + test:m1 have run (campaigns, canvasser, voters exist),
// and migration 2 (storage bucket + policies) is applied.

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
import {
  audioStoragePath,
  createMemoryQueueStore,
  syncQueue,
  type QueuedCapture,
  type SyncPorts,
} from "@canvara/shared";
import { CAMPAIGN_A } from "../m0/fixtures";
import { CANVASSER_A, ensureCanvasser } from "../helpers";

const WALK_LIST_NAME = "M2 Test Walk List — airplane canvass";
const DOOR_COUNT = 5; // doors 1–4: recorded conversations, door 5: not home

const { url, anonKey, serviceRoleKey } = supabaseEnv();
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.");
const service = createServiceClient(url, serviceRoleKey);

let campaignA: string;
let canvasserId: string;
let canvasser: DbClient; // signed in as the canvasser
let walkListId: string;
let stops: { itemId: string; voterId: string }[] = [];
let captures: QueuedCapture[] = [];
const fakeAudio = new Map<string, Uint8Array>();

let online = false;
const store = createMemoryQueueStore();

// The engine's ports, wired like the device: storage upload + row upsert +
// stop status through the canvasser's RLS-scoped client.
const ports: SyncPorts = {
  store,
  async isOnline() {
    return online;
  },
  async readAudio(uri) {
    const bytes = fakeAudio.get(uri);
    if (!bytes) throw new Error(`no such local audio: ${uri}`);
    return bytes;
  },
  async uploadAudio(path, bytes) {
    const { error } = await canvasser.storage
      .from("conversations")
      .upload(path, bytes, { contentType: "audio/mp4" });
    // Same duplicate-tolerant contract as the app's uploader (see
    // apps/field/src/lib/sync.ts): recordings are immutable, so
    // "already exists" is success on retry.
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`storage upload: ${error.message}`);
    }
  },
  async upsertConversation(capture, audioPath) {
    const { error } = await canvasser.from("conversations").upsert(
      {
        id: capture.id,
        campaign_id: capture.campaignId,
        canvasser_id: capture.canvasserId,
        shift_id: capture.shiftId,
        voter_id: capture.voterId,
        voter_id_manual: capture.voterId !== null,
        audio_path: audioPath,
        recorded_at: capture.recordedAt,
        gps:
          capture.gpsLat !== null && capture.gpsLng !== null
            ? `POINT(${capture.gpsLng} ${capture.gpsLat})`
            : null,
        consent_disclosed_at: capture.consentDisclosedAt,
        contact_result: capture.contactResult,
        status: audioPath ? "uploaded" : "captured",
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`conversations upsert: ${error.message}`);
  },
  async updateStopStatus(walkListItemId, status) {
    const { error } = await canvasser
      .from("walk_list_items")
      .update({ status })
      .eq("id", walkListItemId);
    if (error) throw new Error(`stop status: ${error.message}`);
  },
};

function makeCaptures(): QueuedCapture[] {
  const now = Date.now();
  return stops.map((stop, i) => {
    const isNotHome = i === DOOR_COUNT - 1;
    const id = randomUUID();
    let audioUri: string | null = null;
    if (!isNotHome) {
      audioUri = `file:///captures/${id}.m4a`;
      // Distinct fake audio per door so download-verification is meaningful.
      fakeAudio.set(audioUri, new TextEncoder().encode(`m2-fake-audio-door-${i + 1}-${id}`));
    }
    return {
      id,
      kind: isNotHome ? ("status_only" as const) : ("conversation" as const),
      campaignId: campaignA,
      canvasserId,
      shiftId: null,
      voterId: stop.voterId,
      walkListItemId: stop.itemId,
      audioUri,
      recordedAt: new Date(now + i * 60_000).toISOString(),
      gpsLat: 33.415 + i * 0.001,
      gpsLng: -111.831 - i * 0.001,
      consentDisclosedAt: isNotHome ? null : new Date(now + i * 60_000).toISOString(),
      contactResult: isNotHome ? null : "full_conversation",
      stopStatus: isNotHome ? "not_home" : "visited",
      attempts: 0,
      lastError: null,
    };
  });
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

  // Teardown previous M2 runs: the canvasser is test-only, so all of their
  // conversations are ours to remove (review_queue first — no cascade), and
  // campaign A's storage folder is swept entirely.
  const { data: oldConvos } = await service
    .from("conversations")
    .select("id")
    .eq("canvasser_id", canvasserId);
  const oldConvoIds = (oldConvos ?? []).map((c) => c.id);
  if (oldConvoIds.length > 0) {
    await service.from("review_queue").delete().in("conversation_id", oldConvoIds);
  }
  await service.from("conversations").delete().eq("canvasser_id", canvasserId);
  const { data: oldObjects } = await service.storage.from("conversations").list(campaignA);
  if (oldObjects && oldObjects.length > 0) {
    await service.storage
      .from("conversations")
      .remove(oldObjects.map((o) => `${campaignA}/${o.name}`));
  }
  const { data: oldLists } = await service
    .from("walk_lists")
    .select("id")
    .eq("campaign_id", campaignA)
    .like("name", "M2 %");
  for (const l of oldLists ?? []) {
    await service.from("walk_list_items").delete().eq("walk_list_id", l.id);
    await service.from("walk_lists").delete().eq("id", l.id);
  }

  // Make sure the storage bucket exists (idempotent; policies come from
  // migration 2 and cannot be created via the API).
  const { error: bucketErr } = await service.storage.createBucket("conversations", {
    public: false,
  });
  if (bucketErr && !/already exists/i.test(bucketErr.message)) {
    throw new Error(`createBucket: ${bucketErr.message}`);
  }

  // A fresh 5-door walk list from M1's imported voters, with coordinates so
  // the map has pins on a real device.
  const { data: voters, error: votersErr } = await service
    .from("voters")
    .select("id")
    .eq("campaign_id", campaignA)
    .eq("city", "MESA")
    .like("external_id", "M1-%")
    .order("external_id")
    .limit(DOOR_COUNT);
  if (votersErr) throw new Error(votersErr.message);
  if ((voters?.length ?? 0) < DOOR_COUNT) {
    throw new Error("Not enough M1 voters — run `npm run test:m1` first.");
  }
  for (let i = 0; i < voters!.length; i++) {
    const { error } = await service
      .from("voters")
      .update({ location: `POINT(${-111.83 - i * 0.002} ${33.41 + i * 0.002})` })
      .eq("id", voters![i].id);
    if (error) throw new Error(`set voter location: ${error.message}`);
  }

  const { data: list, error: listErr } = await service
    .from("walk_lists")
    .insert({ campaign_id: campaignA, name: WALK_LIST_NAME, assigned_to: canvasserId })
    .select("id")
    .single();
  if (listErr) throw new Error(listErr.message);
  walkListId = list.id;

  const { data: items, error: itemsErr } = await service
    .from("walk_list_items")
    .insert(
      voters!.map((v, i) => ({
        campaign_id: campaignA,
        walk_list_id: walkListId,
        voter_id: v.id,
        position: i + 1,
      })),
    )
    .select("id, voter_id");
  if (itemsErr) throw new Error(itemsErr.message);
  stops = items!.map((i) => ({ itemId: i.id, voterId: i.voter_id }));

  canvasser = await signInCanvasser();
  captures = makeCaptures();
});

async function signInCanvasser(): Promise<DbClient> {
  const client = createAnonClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email: CANVASSER_A.email,
    password: CANVASSER_A.password,
  });
  if (error) throw new Error(`canvasser sign-in: ${error.message}`);
  return client;
}

test("airplane mode: five door captures queue locally, nothing reaches the server", async () => {
  online = false;
  for (const c of captures) await store.add(c);

  const result = await syncQueue(ports);
  assert.equal(result.synced, 0, "nothing syncs while offline");
  assert.equal(result.remaining, DOOR_COUNT, "all five doors held in the queue");

  const { count } = await service
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("canvasser_id", canvasserId);
  assert.equal(count, 0, "server has no conversations yet");
});

test("reconnect: the queue drains completely", async () => {
  online = true;
  const result = await syncQueue(ports);
  assert.equal(result.failed, 0, `no failures: ${result.errors.join("; ")}`);
  assert.equal(result.synced, DOOR_COUNT, "all five doors synced");
  assert.equal(result.remaining, 0, "queue is empty");
});

test("server state: conversations, audio, consent, GPS, and stop statuses all correct", async () => {
  const { data: convos, error } = await service
    .from("conversations")
    .select("id, voter_id, audio_path, status, consent_disclosed_at, gps, recorded_at, contact_result")
    .eq("canvasser_id", canvasserId);
  assert.ifError(error);
  assert.equal(convos!.length, DOOR_COUNT - 1, "4 conversations (not-home door creates none)");

  const expected = new Map(captures.filter((c) => c.kind === "conversation").map((c) => [c.id, c]));
  for (const convo of convos!) {
    const cap = expected.get(convo.id);
    assert.ok(cap, `conversation ${convo.id} matches a queued capture`);
    assert.equal(convo.status, "uploaded");
    assert.equal(convo.audio_path, audioStoragePath(campaignA, convo.id));
    assert.equal(convo.voter_id, cap!.voterId);
    assert.equal(convo.contact_result, "full_conversation");
    assert.ok(convo.consent_disclosed_at, "ADR-6 consent timestamp logged");
    assert.ok(convo.gps, "GPS recorded");
    assert.equal(new Date(convo.recorded_at).toISOString(), cap!.recordedAt);
  }

  // The audio really is in storage, byte-for-byte.
  const { data: objects, error: listErr } = await service.storage
    .from("conversations")
    .list(campaignA);
  assert.ifError(listErr);
  const names = (objects ?? []).map((o) => o.name);
  for (const convo of convos!) {
    assert.ok(names.includes(`${convo.id}.m4a`), `audio object for ${convo.id} exists`);
  }
  const sample = convos![0];
  const { data: blob, error: dlErr } = await service.storage
    .from("conversations")
    .download(sample.audio_path!);
  assert.ifError(dlErr);
  const downloaded = new Uint8Array(await blob!.arrayBuffer());
  const original = fakeAudio.get(expected.get(sample.id)!.audioUri!)!;
  assert.deepEqual(downloaded, original, "downloaded audio matches what was recorded");

  // Stop statuses: 4 visited, 1 not_home.
  const { data: items } = await service
    .from("walk_list_items")
    .select("status")
    .eq("walk_list_id", walkListId);
  const statuses = items!.map((i) => i.status).sort();
  assert.deepEqual(statuses, ["not_home", "visited", "visited", "visited", "visited"]);
});

test("idempotency: re-syncing the same captures creates no duplicates", async () => {
  for (const c of captures) await store.add({ ...c, attempts: 0, lastError: null });
  const result = await syncQueue(ports);
  assert.equal(result.failed, 0, `no failures: ${result.errors.join("; ")}`);
  assert.equal(result.synced, DOOR_COUNT);

  const { count } = await service
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("canvasser_id", canvasserId);
  assert.equal(count, DOOR_COUNT - 1, "still exactly 4 conversations");

  const { data: objects } = await service.storage.from("conversations").list(campaignA);
  assert.equal(
    (objects ?? []).filter((o) => o.name.endsWith(".m4a")).length,
    DOOR_COUNT - 1,
    "still exactly 4 audio objects",
  );
});
