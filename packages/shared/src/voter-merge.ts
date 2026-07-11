// Voter data portal (M14): re-importing a voter file MERGES, it never
// replaces. The design rests on one fact about the schema:
//
//   The file owns the file columns. The door owns everything else.
//
// Door-observed attributes live in voter_attributes (and already win at
// read time — see cohorts.ts). Beliefs, signals, personal context, survey
// responses, and geocoded coordinates are all derived rows. So a re-import
// only ever touches the file columns on `voters`, and can leave every
// scrap of field intelligence untouched. No per-field provenance needed.
//
// This module is pure planning + a thin apply; the exit test drives the
// pure planner to exact numbers and the apply against the live DB.

import type { DbClient, TablesInsert } from "@canvara/db";
import type { MappedVoter } from "./voter-import";

// The file columns a re-import writes. Anything NOT listed here (beliefs,
// voter_attributes, signals, location, vote_history, geocode_*) is
// off-limits to the merge — that is the whole safety guarantee.
function fileColumns(v: MappedVoter): Partial<TablesInsert<"voters">> {
  return {
    first_name: v.first_name,
    last_name: v.last_name,
    address: v.address,
    city: v.city,
    zip: v.zip,
    precinct: v.precinct,
    party: v.party,
    birth_year: v.birth_year,
    gender: v.gender,
    race: v.race,
    income_bracket: v.income_bracket,
    education: v.education,
    religion: v.religion,
  };
}

/** The subset of an existing voter the planner compares against. */
export interface ExistingVoterRow {
  external_id: string;
  address: string | null;
  active: boolean;
  /** True if a prior portal import brought this voter in (last_import_id
   *  set). Voters that arrived another way are never deactivated. */
  portalManaged: boolean;
}

export interface PlanOptions {
  /**
   * Mark active voters absent from this file as inactive ("moved out").
   * Only safe when the file is the campaign's COMPLETE current roll —
   * importing a partial/supplemental file with this on would wrongly
   * retire everyone else. Off by default; even when on, only ever
   * touches portal-managed voters. */
  deactivateAbsent?: boolean;
}

export interface ImportPlan {
  /** Rows keyed by an external_id not currently in the campaign. */
  toInsert: MappedVoter[];
  /** Rows whose external_id already exists — file columns get refreshed. */
  toUpdate: MappedVoter[];
  /** external_ids whose street address changed (geocode must be reset). */
  addressChanged: string[];
  /** external_ids that were inactive and reappear in this file. */
  toReactivate: string[];
  /** Active voters absent from this file — marked inactive, never deleted. */
  toDeactivate: string[];
  /** Incoming rows with no external_id — can't be merge-keyed; skipped. */
  unmergeable: MappedVoter[];
  counts: {
    inserted: number;
    updated: number;
    unchanged: number; // updated rows whose address didn't change (display only)
    dropped: number;
    reactivated: number;
    unmergeable: number;
  };
}

function normAddr(a: string | null): string {
  return (a ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Compute what a re-import would do, without touching the database. Match
 * key is external_id within the campaign. Deterministic and exact.
 */
export function planVoterImport(
  existing: ExistingVoterRow[],
  incoming: MappedVoter[],
  options: PlanOptions = {},
): ImportPlan {
  const existingByExt = new Map(existing.map((e) => [e.external_id, e]));

  const toInsert: MappedVoter[] = [];
  const toUpdate: MappedVoter[] = [];
  const addressChanged: string[] = [];
  const toReactivate: string[] = [];
  const unmergeable: MappedVoter[] = [];
  const seenIncoming = new Set<string>();

  for (const row of incoming) {
    if (!row.external_id) {
      unmergeable.push(row);
      continue;
    }
    // A file may list the same voter twice; the last occurrence wins and
    // we only plan one action per external_id.
    seenIncoming.add(row.external_id);
    const match = existingByExt.get(row.external_id);
    if (!match) {
      toInsert.push(row);
      continue;
    }
    toUpdate.push(row);
    if (normAddr(match.address) !== normAddr(row.address)) {
      addressChanged.push(row.external_id);
    }
    if (!match.active) toReactivate.push(row.external_id);
  }

  // Deduplicate toUpdate/addressChanged if the file repeated an id.
  const dedupUpdate = new Map(toUpdate.map((r) => [r.external_id!, r]));
  const uniqueUpdate = [...dedupUpdate.values()];

  // Deactivation is opt-in AND scoped to portal-managed voters, so a
  // partial import — or one run against a campaign with voters from other
  // sources — can never retire the wrong people.
  const toDeactivate = options.deactivateAbsent
    ? existing
        .filter((e) => e.active && e.portalManaged && !seenIncoming.has(e.external_id))
        .map((e) => e.external_id)
    : [];

  const uniqueAddressChanged = [...new Set(addressChanged)];

  return {
    toInsert,
    toUpdate: uniqueUpdate,
    addressChanged: uniqueAddressChanged,
    toReactivate: [...new Set(toReactivate)],
    toDeactivate,
    unmergeable,
    counts: {
      inserted: toInsert.length,
      updated: uniqueUpdate.length,
      unchanged: uniqueUpdate.length - uniqueAddressChanged.length,
      dropped: toDeactivate.length,
      reactivated: new Set(toReactivate).size,
      unmergeable: unmergeable.length,
    },
  };
}

/** Fetch the comparison rows for a campaign (paged past the 1k cap). */
export async function fetchExistingForMerge(
  db: DbClient,
  campaignId: string,
): Promise<ExistingVoterRow[]> {
  const rows: ExistingVoterRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("voters")
      .select("external_id, address, active, last_import_id")
      .eq("campaign_id", campaignId)
      .not("external_id", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`existing voters: ${error.message}`);
    for (const r of data ?? []) {
      if (r.external_id)
        rows.push({
          external_id: r.external_id,
          address: r.address,
          active: r.active,
          portalManaged: r.last_import_id !== null,
        });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export interface ApplyImportOptions extends PlanOptions {
  campaignId: string;
  actorId: string | null;
  sourceLabel: string;
  filename?: string | null;
  mapping?: unknown;
  batchSize?: number;
}

export interface ApplyImportResult extends ImportPlan {
  importId: string;
}

/**
 * Execute a plan against the database. Upserts file columns by
 * (campaign_id, external_id); resets geocode ONLY where the address
 * changed; marks dropped voters inactive (never deletes). Voter
 * attributes, beliefs, signals, personal context, survey responses, and
 * unchanged coordinates are never touched.
 */
export async function applyVoterImport(
  db: DbClient,
  incoming: MappedVoter[],
  options: ApplyImportOptions,
): Promise<ApplyImportResult> {
  const { campaignId, actorId, sourceLabel } = options;
  const batchSize = options.batchSize ?? 500;

  const existing = await fetchExistingForMerge(db, campaignId);
  const plan = planVoterImport(existing, incoming, {
    deactivateAbsent: options.deactivateAbsent,
  });

  // Record the import first so touched voters can point at it.
  const { data: imp, error: impErr } = await db
    .from("imports")
    .insert({
      campaign_id: campaignId,
      source_label: sourceLabel,
      filename: options.filename ?? null,
      row_count: incoming.length,
      inserted_count: plan.counts.inserted,
      updated_count: plan.counts.updated,
      unchanged_count: plan.counts.unchanged,
      dropped_count: plan.counts.dropped,
      reactivated_count: plan.counts.reactivated,
      unmergeable_count: plan.counts.unmergeable,
      mapping: (options.mapping ?? {}) as TablesInsert<"imports">["mapping"],
      created_by: actorId,
    })
    .select("id")
    .single();
  if (impErr) throw new Error(`record import: ${impErr.message}`);
  const importId = imp.id;

  // Upsert every in-file row's FILE COLUMNS only. Omitting location /
  // vote_history / geocode_* from the payload means the upsert's UPDATE
  // leaves them exactly as they were — preservation by construction.
  const mergeable = incoming.filter((v) => v.external_id);
  // De-dupe by external_id (last occurrence wins) so one upsert row per key.
  const byExt = new Map(mergeable.map((v) => [v.external_id!, v]));
  const rows: TablesInsert<"voters">[] = [...byExt.values()].map((v) => ({
    campaign_id: campaignId,
    external_id: v.external_id,
    ...fileColumns(v),
    active: true,
    dropped_from_file_at: null,
    last_import_id: importId,
  }));
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await db
      .from("voters")
      .upsert(rows.slice(i, i + batchSize), { onConflict: "campaign_id,external_id" });
    if (error) throw new Error(`upsert voters: ${error.message}`);
  }

  // Reset geocode only where the street address changed — the worker will
  // re-geocode. Unchanged addresses keep their coordinates.
  const CHUNK = 150;
  for (let i = 0; i < plan.addressChanged.length; i += CHUNK) {
    const chunk = plan.addressChanged.slice(i, i + CHUNK);
    const { error } = await db
      .from("voters")
      .update({ location: null, geocode_status: null, geocoded_at: null })
      .eq("campaign_id", campaignId)
      .in("external_id", chunk);
    if (error) throw new Error(`reset geocode: ${error.message}`);
  }

  // Mark voters absent from this file inactive — they keep all their
  // history; they just leave the working universe.
  for (let i = 0; i < plan.toDeactivate.length; i += CHUNK) {
    const chunk = plan.toDeactivate.slice(i, i + CHUNK);
    const { error } = await db
      .from("voters")
      .update({ active: false, dropped_from_file_at: new Date().toISOString() })
      .eq("campaign_id", campaignId)
      .in("external_id", chunk);
    if (error) throw new Error(`deactivate voters: ${error.message}`);
  }

  return { ...plan, importId };
}
