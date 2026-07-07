// On-device store (expo-sqlite): the capture queue and a local cache of
// assigned walk lists + voters. The cache is what makes the pre-door
// briefing instant (<2s, FA-3 tier 1) and the whole app usable offline.

import * as SQLite from "expo-sqlite";
import type { QueuedCapture, QueueStore } from "@canvara/shared";

const db = SQLite.openDatabaseSync("canvara-field.db");

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS capture_queue (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS walk_lists_cache (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stop_count INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stops_cache (
    item_id TEXT PRIMARY KEY,
    walk_list_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL,
    voter_id TEXT,
    voter TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stops_list_idx ON stops_cache(walk_list_id, position);
  CREATE TABLE IF NOT EXISTS survey_cache (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    position INTEGER NOT NULL
  );
`);

// ---------- Capture queue (QueueStore implementation) ----------

export const sqliteQueueStore: QueueStore = {
  async add(capture) {
    db.runSync(
      "INSERT OR REPLACE INTO capture_queue (id, payload, attempts, last_error) VALUES (?, ?, ?, ?)",
      [capture.id, JSON.stringify(capture), capture.attempts, capture.lastError],
    );
  },
  async all() {
    const rows = db.getAllSync<{ payload: string; attempts: number; last_error: string | null }>(
      "SELECT payload, attempts, last_error FROM capture_queue",
    );
    return rows.map((r) => ({
      ...(JSON.parse(r.payload) as QueuedCapture),
      attempts: r.attempts,
      lastError: r.last_error,
    }));
  },
  async update(id, patch) {
    const row = db.getFirstSync<{ payload: string }>(
      "SELECT payload FROM capture_queue WHERE id = ?",
      [id],
    );
    if (!row) return;
    const merged = { ...(JSON.parse(row.payload) as QueuedCapture), ...patch };
    db.runSync("UPDATE capture_queue SET payload = ?, attempts = ?, last_error = ? WHERE id = ?", [
      JSON.stringify(merged),
      merged.attempts,
      merged.lastError,
      id,
    ]);
  },
  async remove(id) {
    db.runSync("DELETE FROM capture_queue WHERE id = ?", [id]);
  },
  async size() {
    const row = db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM capture_queue");
    return row?.n ?? 0;
  },
};

export function queueSizeSync(): number {
  const row = db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM capture_queue");
  return row?.n ?? 0;
}

// ---------- Walk list / voter cache ----------

export interface CachedVoter {
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  party: string | null;
  birth_year: number | null;
  gender: string | null;
  precinct: string | null;
  vote_history: Record<string, boolean> | null;
  /** Tier-2 briefing (FA-3): belief-engine top issues, synced with the list. */
  beliefs?: { issue: string; mean: number; strength: number }[];
  /** Connection notes: durable personal facts from prior conversations. */
  connection?: string[];
  /** Door-observed attributes (canvasser/extracted). */
  attributes?: { key: string; value: string }[];
}

export interface CachedStop {
  item_id: string;
  walk_list_id: string;
  position: number;
  status: string;
  voter_id: string | null;
  voter: CachedVoter;
}

export interface CachedWalkList {
  id: string;
  name: string;
  stop_count: number;
  synced_at: string;
}

export function replaceWalkListCache(
  lists: { id: string; name: string }[],
  stops: CachedStop[],
): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM walk_lists_cache");
    db.runSync("DELETE FROM stops_cache");
    const now = new Date().toISOString();
    for (const list of lists) {
      const count = stops.filter((s) => s.walk_list_id === list.id).length;
      db.runSync(
        "INSERT INTO walk_lists_cache (id, name, stop_count, synced_at) VALUES (?, ?, ?, ?)",
        [list.id, list.name, count, now],
      );
    }
    for (const s of stops) {
      db.runSync(
        "INSERT INTO stops_cache (item_id, walk_list_id, position, status, voter_id, voter) VALUES (?, ?, ?, ?, ?, ?)",
        [s.item_id, s.walk_list_id, s.position, s.status, s.voter_id, JSON.stringify(s.voter)],
      );
    }
  });
}

export function getCachedWalkLists(): CachedWalkList[] {
  return db.getAllSync<CachedWalkList>(
    "SELECT id, name, stop_count, synced_at FROM walk_lists_cache ORDER BY name",
  );
}

export function getCachedStops(walkListId: string): CachedStop[] {
  const rows = db.getAllSync<{
    item_id: string;
    walk_list_id: string;
    position: number;
    status: string;
    voter_id: string | null;
    voter: string;
  }>("SELECT * FROM stops_cache WHERE walk_list_id = ? ORDER BY position", [walkListId]);
  return rows.map((r) => ({ ...r, voter: JSON.parse(r.voter) as CachedVoter }));
}

export function getCachedStop(itemId: string): CachedStop | null {
  const r = db.getFirstSync<{
    item_id: string;
    walk_list_id: string;
    position: number;
    status: string;
    voter_id: string | null;
    voter: string;
  }>("SELECT * FROM stops_cache WHERE item_id = ?", [itemId]);
  return r ? { ...r, voter: JSON.parse(r.voter) as CachedVoter } : null;
}

/** Local, offline-safe status update so the UI reflects progress instantly. */
export function setCachedStopStatus(itemId: string, status: string): void {
  db.runSync("UPDATE stops_cache SET status = ? WHERE item_id = ?", [status, itemId]);
}

// ---------- Door-poll question cache (M6.5) ----------

export interface CachedSurveyQuestion {
  id: string;
  question: string;
  options: string[];
  position: number;
}

export function replaceSurveyCache(questions: CachedSurveyQuestion[]): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM survey_cache");
    for (const q of questions) {
      db.runSync("INSERT INTO survey_cache (id, question, options, position) VALUES (?, ?, ?, ?)", [
        q.id,
        q.question,
        JSON.stringify(q.options),
        q.position,
      ]);
    }
  });
}

export function getCachedSurveyQuestions(): CachedSurveyQuestion[] {
  const rows = db.getAllSync<{ id: string; question: string; options: string; position: number }>(
    "SELECT * FROM survey_cache ORDER BY position",
  );
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }));
}
