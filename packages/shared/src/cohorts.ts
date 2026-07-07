// Cohort blocks (M6.5). The generic cohort map mirrors the standard breaks
// professional pollsters use (Pew/Gallup-style), plus issue-stance cohorts
// for elections where one issue trumps demographics.
//
// PRECEDENCE PRINCIPLE: door-observed attributes (voter_attributes, source
// 'canvasser'/'extracted') override voter-file columns when both exist —
// what we learn from a person beats what the file modeled about them.

import type { DbClient } from "@canvara/db";

export interface CohortDimension {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

// Standard pollster demographic breaks.
export const COHORT_DIMENSIONS: CohortDimension[] = [
  {
    key: "gender",
    label: "Gender",
    options: [
      { value: "female", label: "Women" },
      { value: "male", label: "Men" },
    ],
  },
  {
    key: "age_bracket",
    label: "Age",
    options: [
      { value: "18_29", label: "18–29" },
      { value: "30_44", label: "30–44" },
      { value: "45_64", label: "45–64" },
      { value: "65_plus", label: "65+" },
    ],
  },
  {
    key: "race",
    label: "Race / ethnicity",
    options: [
      { value: "white", label: "White" },
      { value: "black", label: "Black" },
      { value: "hispanic", label: "Hispanic / Latino" },
      { value: "asian", label: "Asian" },
      { value: "native", label: "Native American" },
      { value: "other", label: "Other / multiracial" },
    ],
  },
  {
    key: "education",
    label: "Education",
    options: [
      { value: "no_college", label: "No college degree" },
      { value: "college", label: "College degree" },
      { value: "postgrad", label: "Postgraduate" },
    ],
  },
  {
    key: "income_bracket",
    label: "Household income",
    options: [
      { value: "under_50k", label: "Under $50k" },
      { value: "50k_100k", label: "$50k–$100k" },
      { value: "over_100k", label: "Over $100k" },
    ],
  },
  {
    key: "party",
    label: "Party registration",
    options: [
      { value: "republican", label: "Republican" },
      { value: "democrat", label: "Democrat" },
      { value: "independent", label: "Independent / other" },
    ],
  },
  {
    key: "religiosity",
    label: "Religiosity",
    options: [
      { value: "religious", label: "Religious / observant" },
      { value: "secular", label: "Secular / unaffiliated" },
    ],
  },
];

export interface CohortDefinition {
  /** dimension key → accepted canonical values (OR within, AND across). */
  demographics?: Record<string, string[]>;
  /** Voter's latest sentiment on an issue must be one of these. */
  issue_stances?: { issue: string; sentiments: string[] }[];
}

// ---------- Normalization: messy file values → canonical options ----------

const PARTY_MAP: Record<string, string> = {
  rep: "republican", republican: "republican", r: "republican", gop: "republican",
  dem: "democrat", democrat: "democrat", democratic: "democrat", d: "democrat",
  ind: "independent", independent: "independent", i: "independent",
  npp: "independent", npa: "independent", unaffiliated: "independent",
  lbt: "independent", libertarian: "independent", grn: "independent", other: "independent",
};

const GENDER_MAP: Record<string, string> = {
  f: "female", female: "female", w: "female", woman: "female",
  m: "male", male: "male", man: "male",
};

const RACE_MAP: Record<string, string> = {
  white: "white", caucasian: "white", w: "white",
  black: "black", "african american": "black", b: "black",
  hispanic: "hispanic", latino: "hispanic", latina: "hispanic", latinx: "hispanic", h: "hispanic",
  asian: "asian", "asian american": "asian", a: "asian",
  native: "native", "native american": "native", "american indian": "native",
  other: "other", multiracial: "other", mixed: "other",
};

const EDUCATION_MAP: Record<string, string> = {
  "no college": "no_college", "high school": "no_college", hs: "no_college",
  "some college": "no_college", "non-college": "no_college", no_college: "no_college",
  college: "college", bachelors: "college", "bachelor's": "college", ba: "college", bs: "college",
  postgrad: "postgrad", graduate: "postgrad", masters: "postgrad", "master's": "postgrad",
  phd: "postgrad", doctorate: "postgrad", professional: "postgrad",
};

const RELIGIOSITY_MAP: Record<string, string> = {
  religious: "religious", observant: "religious", regular: "religious",
  catholic: "religious", protestant: "religious", evangelical: "religious",
  lds: "religious", mormon: "religious", jewish: "religious", muslim: "religious",
  christian: "religious",
  secular: "secular", none: "secular", atheist: "secular", agnostic: "secular",
  unaffiliated: "secular",
};

const INCOME_MAP: Record<string, string> = {
  under_50k: "under_50k", low: "under_50k", "<50k": "under_50k",
  "50k_100k": "50k_100k", middle: "50k_100k",
  over_100k: "over_100k", high: "over_100k", ">100k": "over_100k", upper: "over_100k",
  "upper-middle": "over_100k",
};

function normalize(dimension: string, raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  switch (dimension) {
    case "party": return PARTY_MAP[v] ?? null;
    case "gender": return GENDER_MAP[v] ?? null;
    case "race": return RACE_MAP[v] ?? null;
    case "education": return EDUCATION_MAP[v] ?? null;
    case "religiosity": return RELIGIOSITY_MAP[v] ?? null;
    case "income_bracket": return INCOME_MAP[v] ?? null;
    default: return v;
  }
}

export function ageBracket(birthYear: number | null, now = new Date()): string | null {
  if (!birthYear) return null;
  const age = now.getFullYear() - birthYear;
  if (age < 18) return null;
  if (age <= 29) return "18_29";
  if (age <= 44) return "30_44";
  if (age <= 64) return "45_64";
  return "65_plus";
}

// ---------- Evaluation ----------

export interface CohortEvaluation {
  voterIds: string[];
  count: number;
  /** support_level → voter count, from each member's latest signal. */
  supportDistribution: Record<string, number>;
}

interface VoterRow {
  id: string;
  gender: string | null;
  birth_year: number | null;
  race: string | null;
  education: string | null;
  income_bracket: string | null;
  party: string | null;
  religion: string | null;
}

/** Map a voter-attributes key to its cohort dimension. */
const ATTRIBUTE_DIMENSION: Record<string, string> = {
  gender: "gender",
  race: "race",
  education: "education",
  income: "income_bracket",
  income_bracket: "income_bracket",
  party: "party",
  religiosity: "religiosity",
  religion: "religiosity",
  language: "language",
};

/**
 * Evaluate a cohort definition against the campaign's voters. Paged reads;
 * fine at pilot scale (≤ tens of thousands). Door-observed attributes
 * override file columns.
 */
export async function evaluateCohort(
  db: DbClient,
  definition: CohortDefinition,
): Promise<CohortEvaluation> {
  // 1. All voters with their file demographics (paged past the 1k cap).
  const voters: VoterRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("voters")
      .select("id, gender, birth_year, race, education, income_bracket, party, religion")
      .range(from, from + 999);
    if (error) throw new Error(`cohort voters: ${error.message}`);
    voters.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // 2. Door-observed attributes (they trump the file).
  const observed = new Map<string, Map<string, string>>();
  {
    const { data, error } = await db
      .from("voter_attributes")
      .select("voter_id, key, value");
    if (error) throw new Error(`cohort attributes: ${error.message}`);
    for (const row of data ?? []) {
      const dimension = ATTRIBUTE_DIMENSION[row.key] ?? row.key;
      const map = observed.get(row.voter_id) ?? new Map<string, string>();
      map.set(dimension, row.value);
      observed.set(row.voter_id, map);
    }
  }

  const dimensionValue = (voter: VoterRow, dimension: string): string | null => {
    const door = observed.get(voter.id)?.get(dimension);
    if (door) return normalize(dimension, door);
    switch (dimension) {
      case "gender": return normalize("gender", voter.gender);
      case "age_bracket": return ageBracket(voter.birth_year);
      case "race": return normalize("race", voter.race);
      case "education": return normalize("education", voter.education);
      case "income_bracket": return normalize("income_bracket", voter.income_bracket);
      case "party": return normalize("party", voter.party);
      case "religiosity": return normalize("religiosity", voter.religion);
      default: return null;
    }
  };

  let members = voters.filter((v) =>
    Object.entries(definition.demographics ?? {}).every(([dimension, accepted]) => {
      const value = dimensionValue(v, dimension);
      return value !== null && accepted.includes(value);
    }),
  );

  // 3. Issue-stance filters: latest signal per voter mentioning the issue.
  const latestSignalByVoter = new Map<
    string,
    { support: string | null; sentiment: Record<string, string>; recordedAt: string }
  >();
  if ((definition.issue_stances ?? []).length > 0 || members.length > 0) {
    const memberIds = new Set(members.map((m) => m.id));
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("signals")
        .select("support_level, issue_sentiment, conversations!inner(voter_id, recorded_at)")
        .range(from, from + 999);
      if (error) throw new Error(`cohort signals: ${error.message}`);
      for (const s of data ?? []) {
        const voterId = s.conversations.voter_id;
        if (!voterId || !memberIds.has(voterId)) continue;
        const prev = latestSignalByVoter.get(voterId);
        if (!prev || s.conversations.recorded_at > prev.recordedAt) {
          latestSignalByVoter.set(voterId, {
            support: s.support_level,
            sentiment: (s.issue_sentiment as Record<string, string> | null) ?? {},
            recordedAt: s.conversations.recorded_at,
          });
        }
      }
      if (!data || data.length < 1000) break;
    }
  }

  for (const stance of definition.issue_stances ?? []) {
    members = members.filter((v) => {
      const latest = latestSignalByVoter.get(v.id);
      const sentiment = latest?.sentiment[stance.issue];
      return sentiment !== undefined && stance.sentiments.includes(sentiment);
    });
  }

  const supportDistribution: Record<string, number> = {};
  for (const member of members) {
    const support = latestSignalByVoter.get(member.id)?.support;
    if (support) supportDistribution[support] = (supportDistribution[support] ?? 0) + 1;
  }

  return {
    voterIds: members.map((m) => m.id),
    count: members.length,
    supportDistribution,
  };
}
