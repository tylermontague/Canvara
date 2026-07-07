// Canvara pipeline worker (IE-1): polls for uploaded conversations and runs
// them through transcription → correlation → extraction. Idempotent claims;
// safe to run multiple instances.

import { loadConfig } from "./config";
import { processAvailable } from "./pipeline";
import { runRetentionSweep } from "./retention";

const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main() {
  const { db, deepgramKey, pollIntervalMs } = loadConfig();
  console.log(`canvara worker: polling every ${pollIntervalMs}ms`);

  let lastSweep = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  while (!stopping) {
    try {
      // Daily retention sweep (CX-2), first pass on startup.
      if (Date.now() - lastSweep > RETENTION_SWEEP_INTERVAL_MS) {
        lastSweep = Date.now();
        const retention = await runRetentionSweep(db);
        if (retention.purged > 0 || retention.errors.length > 0) {
          console.log(
            `[worker] retention: purged=${retention.purged} errors=${retention.errors.length}`,
          );
        }
      }

      const stats = await processAvailable(db, deepgramKey);
      const total = stats.transcribed + stats.extracted + stats.review + stats.failed;
      if (total > 0) {
        console.log(
          `[worker] transcribed=${stats.transcribed} extracted=${stats.extracted} ` +
            `review=${stats.review} failed=${stats.failed}`,
        );
      }
    } catch (err) {
      console.error("[worker] poll error:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  console.log("canvara worker: stopped");
}

void main();
