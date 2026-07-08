// Voter geocoding sweep (M10): voters imported from a file carry street
// addresses but no coordinates. This sweep batches them through the free
// Census Bureau geocoder and stores POINT locations so the district map
// fills in automatically. Each voter is attempted exactly once — matched
// or unmatched, geocode_status records the outcome and the candidate scan
// skips them thereafter. A failed request marks nothing, so the next
// sweep retries the same batch.

import type { DbClient } from "@canvara/db";
import {
  buildCensusBatchCsv,
  parseCensusBatchResponse,
  type GeocodeInputRow,
} from "@canvara/shared";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
// The service accepts up to 10k rows per request; keep sweeps modest so a
// worker cycle stays quick and a mid-batch crash loses little work.
const DEFAULT_BATCH_SIZE = 2000;

export interface GeocodeStats {
  examined: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

interface CandidateRow {
  id: string;
  campaign_id: string;
  address: string | null;
  city: string | null;
  zip: string | null;
}

/** Voters that still need a geocode attempt: no location, never tried. */
export async function fetchGeocodeCandidates(
  db: DbClient,
  limit = DEFAULT_BATCH_SIZE,
): Promise<CandidateRow[]> {
  const { data, error } = await db
    .from("voters")
    .select("id, campaign_id, address, city, zip")
    .is("location", null)
    .is("geocode_status", null)
    .not("address", "is", null)
    .limit(limit);
  if (error) throw new Error(`geocode candidates: ${error.message}`);
  return data ?? [];
}

export interface GeocodeSweepOptions {
  batchSize?: number;
  /** Restrict the sweep to specific voters (targeted re-geocode, tests). */
  voterIds?: string[];
  fetchImpl?: typeof fetch;
}

export async function runGeocodeSweep(
  db: DbClient,
  options: GeocodeSweepOptions = {},
): Promise<GeocodeStats> {
  const stats: GeocodeStats = { examined: 0, matched: 0, unmatched: 0, errors: [] };
  const doFetch = options.fetchImpl ?? fetch;

  let candidates: CandidateRow[];
  if (options.voterIds) {
    const { data, error } = await db
      .from("voters")
      .select("id, campaign_id, address, city, zip")
      .in("id", options.voterIds)
      .is("location", null)
      .is("geocode_status", null);
    if (error) throw new Error(`geocode voters: ${error.message}`);
    candidates = data ?? [];
  } else {
    candidates = await fetchGeocodeCandidates(db, options.batchSize);
  }
  if (candidates.length === 0) return stats;

  // The campaign's state completes each address (blank states can 502
  // the Census service).
  const { data: campaigns, error: campErr } = await db
    .from("campaigns")
    .select("id, state");
  if (campErr) throw new Error(`geocode campaigns: ${campErr.message}`);
  const stateOf = new Map((campaigns ?? []).map((c) => [c.id, c.state]));

  const attempted = candidates.filter((c) => c.address && c.address.trim() !== "");
  const rows: GeocodeInputRow[] = attempted.map((c) => ({
    id: c.id,
    address: c.address!,
    city: c.city,
    state: stateOf.get(c.campaign_id) ?? null,
    zip: c.zip,
  }));

  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([buildCensusBatchCsv(rows)], { type: "text/csv" }),
    "addresses.csv",
  );
  form.append("benchmark", "Public_AR_Current");

  const res = await doFetch(CENSUS_BATCH_URL, { method: "POST", body: form });
  if (!res.ok) {
    // Mark nothing — the same batch is retried on the next sweep.
    stats.errors.push(`census batch: HTTP ${res.status}`);
    return stats;
  }
  const results = parseCensusBatchResponse(await res.text());

  const now = new Date().toISOString();
  for (const row of attempted) {
    stats.examined++;
    const hit = results.get(row.id);
    try {
      if (hit) {
        const { error } = await db
          .from("voters")
          .update({
            location: `POINT(${hit.lng} ${hit.lat})`,
            geocode_status: "matched",
            geocoded_at: now,
          })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        stats.matched++;
      } else {
        // No_Match / Tie / missing from the response: don't retry forever.
        const { error } = await db
          .from("voters")
          .update({ geocode_status: "unmatched", geocoded_at: now })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        stats.unmatched++;
      }
    } catch (err) {
      stats.errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Addressless voters passed in explicitly can never match — record that.
  for (const row of candidates) {
    if (attempted.includes(row)) continue;
    stats.examined++;
    const { error } = await db
      .from("voters")
      .update({ geocode_status: "unmatched", geocoded_at: now })
      .eq("id", row.id);
    if (error) stats.errors.push(`${row.id}: ${error.message}`);
    else stats.unmatched++;
  }

  return stats;
}
