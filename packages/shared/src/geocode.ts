// Census batch geocoder helpers (M10). Pure CSV build/parse — the worker
// owns the network call and database writes.
//
// Request rows:  id,street,city,state,zip  (blank state can 502 the
// service — always send the campaign's state).
// Response rows: id,"input","Match|No_Match|Tie","Exact|Non_Exact",
//                "matched address","lng,lat",tigerline,side
// No_Match / Tie rows carry fewer fields; both count as unmatched.

import { parseCsv } from "./voter-import";

export interface GeocodeInputRow {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function csvField(value: string | null): string {
  // One address per line: strip embedded newlines, escape quotes.
  return `"${(value ?? "").replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;
}

/** Build the addressFile body the Census batch endpoint expects. */
export function buildCensusBatchCsv(rows: GeocodeInputRow[]): string {
  return rows
    .map((r) =>
      [csvField(r.id), csvField(r.address), csvField(r.city), csvField(r.state), csvField(r.zip)].join(","),
    )
    .join("\n");
}

/**
 * Parse the batch response: id → coordinates for matches (exact or not),
 * id → null for No_Match / Tie. IDs the service never returned are absent.
 */
export function parseCensusBatchResponse(
  text: string,
): Map<string, { lat: number; lng: number } | null> {
  const results = new Map<string, { lat: number; lng: number } | null>();
  for (const row of parseCsv(text)) {
    const [id, , status, , , coords] = row;
    if (!id || !status) continue;
    if (status === "Match" && coords) {
      const [lng, lat] = coords.split(",").map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        results.set(id, { lat, lng });
        continue;
      }
    }
    results.set(id, null);
  }
  return results;
}
