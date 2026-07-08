// District dashboard stats (M8): registration, turnout, and contact
// coverage. Shared by the /lab dashboard and the M8 exit test.

import type { DbClient } from "@canvara/db";

export type ElectionCycle = "presidential" | "midterm" | "other";

/** "2024_general" → {year: 2024, kind: "general", cycle: "presidential"} */
export function classifyElection(key: string): {
  year: number;
  kind: string;
  cycle: ElectionCycle;
} | null {
  const match = key.match(/^(\d{4})_(\w+)$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const kind = match[2];
  const cycle: ElectionCycle =
    year % 4 === 0 ? "presidential" : year % 4 === 2 ? "midterm" : "other";
  return { year, kind, cycle };
}

export interface ElectionTurnout {
  election: string;
  voted: number;
  pct: number; // of registered
  cycle: ElectionCycle;
}

export interface DistrictStats {
  registered: number;
  /** General elections only, newest first. */
  turnout: ElectionTurnout[];
  /** Mean turnout % across general elections on file. */
  avgTurnoutPct: number | null;
  /** Most recent general election matching the current cycle type. */
  lastSimilar: ElectionTurnout | null;
  canvassed: number;
  canvassedPct: number;
  otherContacted: number;
  otherContactedPct: number;
}

const CONTACT_RESULTS = ["answered", "brief_exchange", "full_conversation"];

async function distinctVoterIds(
  db: DbClient,
  table: "conversations" | "contact_log",
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    let query;
    if (table === "conversations") {
      query = db
        .from("conversations")
        .select("voter_id")
        .in("contact_result", CONTACT_RESULTS)
        .not("voter_id", "is", null)
        .range(from, from + 999);
    } else {
      query = db.from("contact_log").select("voter_id").range(from, from + 999);
    }
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data ?? []) {
      if (row.voter_id) ids.add(row.voter_id);
    }
    if (!data || data.length < 1000) break;
  }
  return ids;
}

/**
 * @param cycleYear the campaign's election year (drives "last similar
 * election": a midterm campaign compares to the previous midterm, a
 * presidential campaign to the previous presidential year).
 */
export async function fetchDistrictStats(
  db: DbClient,
  cycleYear = new Date().getFullYear(),
): Promise<DistrictStats> {
  const [registeredRes, turnoutRes, canvassedIds, otherIds] = await Promise.all([
    db.from("voters").select("id", { count: "exact", head: true }),
    db.from("turnout_by_election").select("election, voted"),
    distinctVoterIds(db, "conversations"),
    distinctVoterIds(db, "contact_log"),
  ]);
  if (registeredRes.error) throw new Error(`registered: ${registeredRes.error.message}`);
  if (turnoutRes.error) throw new Error(`turnout: ${turnoutRes.error.message}`);

  const registered = registeredRes.count ?? 0;

  const turnout: ElectionTurnout[] = (turnoutRes.data ?? [])
    .map((row) => {
      const info = classifyElection(row.election);
      if (!info || info.kind !== "general") return null;
      return {
        election: row.election,
        voted: row.voted,
        pct: registered > 0 ? (row.voted / registered) * 100 : 0,
        cycle: info.cycle,
      };
    })
    .filter((t): t is ElectionTurnout => t !== null)
    .sort((a, b) => b.election.localeCompare(a.election));

  const avgTurnoutPct =
    turnout.length > 0 ? turnout.reduce((sum, t) => sum + t.pct, 0) / turnout.length : null;

  const currentCycle: ElectionCycle =
    cycleYear % 4 === 0 ? "presidential" : cycleYear % 4 === 2 ? "midterm" : "other";
  const lastSimilar = turnout.find((t) => t.cycle === currentCycle) ?? null;

  return {
    registered,
    turnout,
    avgTurnoutPct,
    lastSimilar,
    canvassed: canvassedIds.size,
    canvassedPct: registered > 0 ? (canvassedIds.size / registered) * 100 : 0,
    otherContacted: otherIds.size,
    otherContactedPct: registered > 0 ? (otherIds.size / registered) * 100 : 0,
  };
}
