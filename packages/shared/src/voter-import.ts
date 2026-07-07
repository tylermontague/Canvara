// Voter file CSV import (CC-9): parsing, header-row detection, column
// mapping with auto-suggestion, and row → voter mapping.
//
// Real voter/parcel files are messy — legal-disclaimer preambles, multi-row
// headers, split address columns, duplicate column names ("Zip" for both the
// street and mailing address). This module handles them and is shared by the
// console import UI and the M1 exit test so both exercise the same code path.

import Papa from "papaparse";

// ---------- Parsing ----------

/** Parse CSV text into a rectangular string grid. Empty lines dropped. */
export function parseCsv(text: string): string[][] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(withoutBom, {
    skipEmptyLines: "greedy",
  });
  return result.data.map((row) => row.map((cell) => (cell ?? "").trim()));
}

// ---------- Voter fields ----------

export const VOTER_FIELDS = [
  { key: "external_id", label: "External ID", multi: false },
  { key: "first_name", label: "First name", multi: false },
  { key: "last_name", label: "Last name", multi: false },
  { key: "address", label: "Street address", multi: true },
  { key: "city", label: "City", multi: false },
  { key: "zip", label: "ZIP", multi: false },
  { key: "precinct", label: "Precinct", multi: false },
  { key: "party", label: "Party", multi: false },
  { key: "birth_year", label: "Birth year", multi: false },
  { key: "gender", label: "Gender", multi: false },
  { key: "race", label: "Race / ethnicity", multi: false },
  { key: "income_bracket", label: "Income", multi: false },
  { key: "education", label: "Education", multi: false },
  { key: "religion", label: "Religion", multi: false },
] as const;

export type VoterFieldKey = (typeof VOTER_FIELDS)[number]["key"];

/**
 * Column mapping: voter field → CSV column indices. `address` may take
 * several columns (e.g. Num + Dir + Street Name), joined with spaces in
 * the order given. Other fields use the first index only.
 */
export type ColumnMapping = Partial<Record<VoterFieldKey, number[]>>;

export interface MappedVoter {
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  precinct: string | null;
  party: string | null;
  birth_year: number | null;
  gender: string | null;
  race: string | null;
  income_bracket: string | null;
  education: string | null;
  religion: string | null;
}

// ---------- Header-row detection ----------

const HEADER_KEYWORDS = [
  "first",
  "last",
  "name",
  "address",
  "street",
  "city",
  "zip",
  "precinct",
  "party",
  "gender",
  "birth",
  "dob",
  "voter",
  "id",
  "dist",
];

function looksNumeric(cell: string): boolean {
  return cell !== "" && /^[\d.,/-]+$/.test(cell);
}

/**
 * Find the most likely header row within the first `scanLimit` rows.
 * Scores each candidate on cell fill, label-like cells, known header
 * keywords, and whether the following row looks like data.
 */
export function detectHeaderRow(rows: string[][], scanLimit = 25): number {
  let best = 0;
  let bestScore = -Infinity;
  const limit = Math.min(scanLimit, rows.length);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const filled = row.filter((c) => c !== "");
    if (filled.length < 2) continue;

    const fillRatio = filled.length / row.length;
    const labelLike =
      filled.filter((c) => c.length <= 40 && /[a-zA-Z]/.test(c) && !looksNumeric(c)).length /
      filled.length;
    const keywordHits = filled.filter((c) => {
      const n = c.toLowerCase();
      return HEADER_KEYWORDS.some((k) => n.includes(k));
    }).length;

    const next = rows[i + 1];
    const nextLooksLikeData = next
      ? next.filter((c) => looksNumeric(c)).length >= 2 ||
        (next.filter((c) => c !== "").length >= filled.length && i + 1 >= limit - 1)
      : false;

    const score =
      fillRatio * 2 +
      labelLike * 3 +
      Math.min(keywordHits, 6) * 1.5 +
      (nextLooksLikeData ? 2 : 0) -
      i * 0.05; // mild preference for earlier rows on ties

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// ---------- Mapping suggestion ----------

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Synonyms checked in order; first match wins. Matching is "normalized
// header contains synonym". Columns whose header mentions "mail" are
// excluded — mailing address is not the door-knock address.
const FIELD_SYNONYMS: Record<Exclude<VoterFieldKey, "address">, string[]> = {
  external_id: ["voter id", "voterid", "registrant id", "external id", "parcel", "record id"],
  first_name: ["first middle name", "first name", "firstname", "first"],
  last_name: ["last name or trust name", "last name", "lastname", "surname", "last"],
  city: ["city", "town"],
  zip: ["zip", "postal"],
  precinct: ["precinct", "pct"],
  party: ["party"],
  birth_year: ["birth year", "year of birth", "yob", "birthdate", "date of birth", "dob", "birth"],
  gender: ["gender", "sex"],
  race: ["race ethnicity", "ethnicity", "race"],
  income_bracket: ["household income", "income bracket", "income"],
  education: ["education level", "education", "edu"],
  religion: ["religious affiliation", "religion", "faith"],
};

// Street-address parts, in the order they should be joined.
const ADDRESS_PART_SYNONYMS = [
  ["street num", "house num", "house number", "num", "number"],
  ["street dir", "dir", "direction", "prefix"],
  ["street name", "street address", "address line 1", "address", "street"],
];

/** Suggest a column mapping from header cell names. User can override. */
export function suggestMapping(headerCells: string[]): ColumnMapping {
  const normalized = headerCells.map(normalizeHeader);
  const isMail = normalized.map((n) => n.includes("mail"));
  const claimed = new Set<number>();
  const mapping: ColumnMapping = {};

  const findColumn = (synonyms: string[]): number | undefined => {
    for (const syn of synonyms) {
      // exact match first, then contains
      for (const pass of ["exact", "contains"] as const) {
        for (let i = 0; i < normalized.length; i++) {
          if (claimed.has(i) || isMail[i] || normalized[i] === "") continue;
          const hit = pass === "exact" ? normalized[i] === syn : normalized[i].includes(syn);
          if (hit) return i;
        }
      }
    }
    return undefined;
  };

  for (const field of Object.keys(FIELD_SYNONYMS) as (keyof typeof FIELD_SYNONYMS)[]) {
    const col = findColumn(FIELD_SYNONYMS[field]);
    if (col !== undefined) {
      mapping[field] = [col];
      claimed.add(col);
    }
  }

  const addressCols: number[] = [];
  for (const partSynonyms of ADDRESS_PART_SYNONYMS) {
    const col = findColumn(partSynonyms);
    if (col !== undefined) {
      addressCols.push(col);
      claimed.add(col);
    }
  }
  if (addressCols.length > 0) mapping.address = addressCols;

  return mapping;
}

// ---------- Row mapping ----------

export interface MapRowsResult {
  voters: MappedVoter[];
  /** Rows skipped because every mapped field was empty. */
  skipped: number;
}

function parseBirthYear(raw: string): number | null {
  const yearMatch = raw.match(/\b(18|19|20)\d{2}\b/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now ? year : null;
}

/** Apply a column mapping to the data rows below the header. */
export function mapRows(
  rows: string[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
): MapRowsResult {
  const voters: MappedVoter[] = [];
  let skipped = 0;

  const pick = (row: string[], field: VoterFieldKey): string | null => {
    const cols = mapping[field];
    if (!cols || cols.length === 0) return null;
    const value = cols
      .map((i) => (row[i] ?? "").trim())
      .filter((v) => v !== "")
      .join(" ");
    return value === "" ? null : value;
  };

  for (const row of rows.slice(headerRowIndex + 1)) {
    const rawYear = pick(row, "birth_year");
    const voter: MappedVoter = {
      external_id: pick(row, "external_id"),
      first_name: pick(row, "first_name"),
      last_name: pick(row, "last_name"),
      address: pick(row, "address"),
      city: pick(row, "city"),
      zip: pick(row, "zip"),
      precinct: pick(row, "precinct"),
      party: pick(row, "party"),
      birth_year: rawYear ? parseBirthYear(rawYear) : null,
      gender: pick(row, "gender"),
      race: pick(row, "race"),
      income_bracket: pick(row, "income_bracket"),
      education: pick(row, "education"),
      religion: pick(row, "religion"),
    };

    const hasIdentity = voter.first_name || voter.last_name || voter.address || voter.external_id;
    if (!hasIdentity) {
      skipped++;
      continue;
    }
    voters.push(voter);
  }

  return { voters, skipped };
}
