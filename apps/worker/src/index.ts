// Canvara pipeline worker (IE-*): queue consumer, ASR, extraction, belief engine.
// M0: stub entry point. The job loop lands in M3.
// Uses the service_role key and bypasses RLS by design — it must always set
// campaign_id explicitly and never join across tenants (see schema v1 notes).

import "dotenv/config";

function main() {
  console.log("canvara worker: stub (pipeline lands in M3)");
}

main();
