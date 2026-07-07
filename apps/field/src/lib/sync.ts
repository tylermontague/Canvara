// Sync wiring: shared engine + device ports (FA-7).
// Down: assigned walk lists + voters → SQLite cache (briefing works offline).
// Up: capture queue → Supabase Storage + conversations rows on reconnect.

import * as Network from "expo-network";
import { File } from "expo-file-system";
import {
  fetchVoterBeliefs,
  syncQueue,
  type QueuedCapture,
  type SyncPorts,
  type SyncResult,
} from "@canvara/shared";
import type { TablesInsert } from "@canvara/db";
import { supabase } from "./supabase";
import {
  sqliteQueueStore,
  replaceWalkListCache,
  replaceSurveyCache,
  type CachedStop,
} from "./local-db";
import type { Profile } from "./session";

function captureToRow(capture: QueuedCapture, audioPath: string | null): TablesInsert<"conversations"> {
  return {
    id: capture.id,
    campaign_id: capture.campaignId,
    canvasser_id: capture.canvasserId,
    shift_id: capture.shiftId,
    voter_id: capture.voterId,
    voter_id_manual: capture.voterId !== null, // walk-list stop = canvasser-confirmed door (IE-3)
    audio_path: audioPath,
    recorded_at: capture.recordedAt,
    gps:
      capture.gpsLat !== null && capture.gpsLng !== null
        ? `POINT(${capture.gpsLng} ${capture.gpsLat})`
        : null,
    consent_disclosed_at: capture.consentDisclosedAt,
    contact_result: capture.contactResult,
    status: audioPath ? "uploaded" : "captured",
  };
}

const ports: SyncPorts = {
  store: sqliteQueueStore,
  async isOnline() {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
  async readAudio(uri) {
    return await new File(uri).bytes();
  },
  async uploadAudio(path, bytes) {
    const { error } = await supabase.storage
      .from("conversations")
      .upload(path, bytes, { contentType: "audio/mp4" });
    // Path is keyed by conversation UUID: "already exists" means a prior
    // attempt landed. Recordings are immutable (no storage UPDATE policy).
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`storage upload: ${error.message}`);
    }
  },
  async upsertConversation(capture, audioPath) {
    const { error } = await supabase
      .from("conversations")
      .upsert(captureToRow(capture, audioPath), { onConflict: "id" });
    if (error) throw new Error(`conversations upsert: ${error.message}`);
  },
  async updateStopStatus(walkListItemId, status) {
    const { error } = await supabase
      .from("walk_list_items")
      .update({ status })
      .eq("id", walkListItemId);
    if (error) throw new Error(`stop status: ${error.message}`);
  },
  async saveSurveyResponses(capture) {
    const rows = (capture.surveyResponses ?? []).map((r) => ({
      campaign_id: capture.campaignId,
      question_id: r.questionId,
      conversation_id: capture.id,
      voter_id: capture.voterId,
      answer: r.answer,
    }));
    const { error } = await supabase
      .from("survey_responses")
      .upsert(rows, { onConflict: "question_id,conversation_id" });
    if (error) throw new Error(`survey responses: ${error.message}`);
  },
  async deleteLocalAudio(uri) {
    new File(uri).delete();
  },
};

let syncing = false;

/** Drain the capture queue if online. Re-entrant-safe. */
export async function syncUp(): Promise<SyncResult | null> {
  if (syncing) return null;
  syncing = true;
  try {
    return await syncQueue(ports);
  } finally {
    syncing = false;
  }
}

/** Start syncing whenever connectivity returns. Returns an unsubscribe fn. */
export function watchConnectivity(onSynced?: (r: SyncResult) => void): () => void {
  const sub = Network.addNetworkStateListener((state) => {
    if (state.isConnected) {
      void syncUp().then((r) => {
        if (r && onSynced) onSynced(r);
      });
    }
  });
  return () => sub.remove();
}

/**
 * Pull the canvasser's assigned walk lists + stops + voters into the local
 * cache. Call while online (sign-in, pull-to-refresh, shift start).
 */
export async function syncDown(profile: Profile): Promise<{ lists: number; stops: number }> {
  const { data: lists, error: listsErr } = await supabase
    .from("walk_lists")
    .select("id, name")
    .eq("assigned_to", profile.id);
  if (listsErr) throw new Error(listsErr.message);

  const listIds = (lists ?? []).map((l) => l.id);
  let stops: CachedStop[] = [];
  if (listIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from("walk_list_items")
      .select(
        "id, walk_list_id, position, status, voter_id, voters(first_name, last_name, address, city, zip, party, birth_year, gender, precinct, vote_history)",
      )
      .in("walk_list_id", listIds)
      .order("position");
    if (itemsErr) throw new Error(itemsErr.message);

    // Tier-2 briefing (FA-3): belief-engine predictions, connection notes,
    // and door-observed attributes, cached with the list so the door screen
    // stays instant and offline-safe.
    const voterIds = [...new Set((items ?? []).map((i) => i.voter_id).filter((v): v is string => v !== null))];
    let beliefs = new Map<string, { issue: string; mean: number; strength: number }[]>();
    const connection = new Map<string, string[]>();
    const attributes = new Map<string, { key: string; value: string }[]>();
    try {
      beliefs = await fetchVoterBeliefs(supabase, voterIds);
      if (voterIds.length > 0) {
        const [{ data: contextRows }, { data: attrRows }] = await Promise.all([
          supabase
            .from("signals")
            .select("personal_context, conversations!inner(voter_id, recorded_at)")
            .in("conversations.voter_id", voterIds)
            .order("created_at", { ascending: false })
            .limit(400),
          supabase
            .from("voter_attributes")
            .select("voter_id, key, value")
            .in("voter_id", voterIds),
        ]);
        for (const row of contextRows ?? []) {
          const vid = row.conversations.voter_id;
          if (!vid) continue;
          const list = connection.get(vid) ?? [];
          for (const fact of row.personal_context ?? []) {
            if (list.length < 6 && !list.includes(fact)) list.push(fact);
          }
          connection.set(vid, list);
        }
        for (const row of attrRows ?? []) {
          const list = attributes.get(row.voter_id) ?? [];
          list.push({ key: row.key, value: row.value });
          attributes.set(row.voter_id, list);
        }
      }
    } catch {
      // Enhancements — sync-down must not fail on them.
    }

    stops = (items ?? []).map((i) => ({
      item_id: i.id,
      walk_list_id: i.walk_list_id,
      position: i.position,
      status: i.status,
      voter_id: i.voter_id,
      voter: {
        first_name: i.voters?.first_name ?? null,
        last_name: i.voters?.last_name ?? null,
        address: i.voters?.address ?? null,
        city: i.voters?.city ?? null,
        zip: i.voters?.zip ?? null,
        party: i.voters?.party ?? null,
        birth_year: i.voters?.birth_year ?? null,
        gender: i.voters?.gender ?? null,
        precinct: i.voters?.precinct ?? null,
        vote_history: (i.voters?.vote_history as Record<string, boolean> | null) ?? null,
        beliefs: i.voter_id
          ? (beliefs.get(i.voter_id) ?? [])
              .filter((b) => b.strength >= 1)
              .slice(0, 3)
          : [],
        connection: i.voter_id ? (connection.get(i.voter_id) ?? []) : [],
        attributes: i.voter_id ? (attributes.get(i.voter_id) ?? []) : [],
      },
    }));
  }

  replaceWalkListCache(lists ?? [], stops);

  // Door-poll questions (M6.5) — cached so polls work offline at the door.
  try {
    const { data: questions } = await supabase
      .from("survey_questions")
      .select("id, question, options, position")
      .eq("active", true)
      .order("position");
    replaceSurveyCache(questions ?? []);
  } catch {
    // keep the previous cache on failure
  }

  return { lists: listIds.length, stops: stops.length };
}
