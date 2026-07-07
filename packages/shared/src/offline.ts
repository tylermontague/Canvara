// Offline-first capture queue + sync engine (FA-7, ADR-6).
//
// Pure TypeScript with pluggable ports so the same engine runs on-device
// (expo-sqlite store, Supabase Storage uploader) and in the M2 exit test
// (in-memory store, simulated network). Captures are idempotent: the
// conversation id is a client-generated UUID, uploads use upsert, and the
// row insert is an upsert on that id — retries and duplicate syncs are safe.

export interface QueuedCapture {
  /** Client-generated conversation UUID — the idempotency key. */
  id: string;
  /**
   * 'conversation': audio + conversations row (+ optional stop status).
   * 'status_only': just records the door outcome (e.g. not home) —
   * no conversations row is created.
   */
  kind: "conversation" | "status_only";
  campaignId: string;
  canvasserId: string;
  shiftId: string | null;
  voterId: string | null;
  walkListItemId: string | null;
  /** Local audio file URI on the device; null if recording failed/absent. */
  audioUri: string | null;
  recordedAt: string; // ISO timestamp
  gpsLat: number | null;
  gpsLng: number | null;
  /** ADR-6: when the canvasser confirmed the automated-notes disclosure. */
  consentDisclosedAt: string | null;
  contactResult: string | null;
  /** walk_list_items.status to record for this stop, if any. */
  stopStatus: string | null;
  attempts: number;
  lastError: string | null;
}

export interface QueueStore {
  add(capture: QueuedCapture): Promise<void>;
  all(): Promise<QueuedCapture[]>;
  update(id: string, patch: Partial<QueuedCapture>): Promise<void>;
  remove(id: string): Promise<void>;
  size(): Promise<number>;
}

export interface SyncPorts {
  store: QueueStore;
  isOnline(): Promise<boolean>;
  /** Read the local audio file for upload. */
  readAudio(uri: string): Promise<Uint8Array>;
  /**
   * Upload audio bytes to remote storage at the given path. Must be
   * idempotent: the path is keyed by the conversation UUID, so an
   * "already exists" response means a prior attempt succeeded and must be
   * treated as success (recordings are immutable — no overwrites).
   */
  uploadAudio(path: string, bytes: Uint8Array): Promise<void>;
  /** Upsert the conversations row (onConflict: id). */
  upsertConversation(capture: QueuedCapture, audioPath: string | null): Promise<void>;
  /** Record the stop outcome on walk_list_items. */
  updateStopStatus(walkListItemId: string, status: string): Promise<void>;
  /** Optional: clean up the local audio file after a successful sync. */
  deleteLocalAudio?(uri: string): Promise<void>;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
  errors: string[];
}

/** Storage path convention: {campaign_id}/{conversation_id}.m4a */
export function audioStoragePath(campaignId: string, conversationId: string): string {
  return `${campaignId}/${conversationId}.m4a`;
}

/** Max sync attempts before a capture is left in the queue for inspection. */
export const MAX_SYNC_ATTEMPTS = 8;

/**
 * Drain the capture queue. Safe to call repeatedly (foreground, reconnect,
 * timer): offline is a no-op, each capture is fully processed before being
 * removed, and every step is idempotent.
 */
export async function syncQueue(ports: SyncPorts): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, remaining: 0, errors: [] };

  if (!(await ports.isOnline())) {
    result.remaining = await ports.store.size();
    return result;
  }

  for (const capture of await ports.store.all()) {
    if (capture.attempts >= MAX_SYNC_ATTEMPTS) {
      result.errors.push(`${capture.id}: gave up after ${capture.attempts} attempts`);
      continue;
    }
    try {
      let audioPath: string | null = null;
      if (capture.kind === "conversation") {
        if (capture.audioUri) {
          audioPath = audioStoragePath(capture.campaignId, capture.id);
          const bytes = await ports.readAudio(capture.audioUri);
          await ports.uploadAudio(audioPath, bytes);
        }
        await ports.upsertConversation(capture, audioPath);
      }
      if (capture.walkListItemId && capture.stopStatus) {
        await ports.updateStopStatus(capture.walkListItemId, capture.stopStatus);
      }
      await ports.store.remove(capture.id);
      if (capture.audioUri && ports.deleteLocalAudio) {
        try {
          await ports.deleteLocalAudio(capture.audioUri);
        } catch {
          // Local cleanup failure must never block the sync.
        }
      }
      result.synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ports.store.update(capture.id, {
        attempts: capture.attempts + 1,
        lastError: message,
      });
      result.failed++;
      result.errors.push(`${capture.id}: ${message}`);
    }
  }

  result.remaining = await ports.store.size();
  return result;
}

/** Simple in-memory QueueStore — used by tests and as a reference. */
export function createMemoryQueueStore(): QueueStore {
  const items = new Map<string, QueuedCapture>();
  return {
    async add(capture) {
      items.set(capture.id, { ...capture });
    },
    async all() {
      return [...items.values()].map((c) => ({ ...c }));
    },
    async update(id, patch) {
      const existing = items.get(id);
      if (existing) items.set(id, { ...existing, ...patch });
    },
    async remove(id) {
      items.delete(id);
    },
    async size() {
      return items.size;
    },
  };
}
