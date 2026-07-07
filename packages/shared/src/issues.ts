// Starter issue taxonomy (v1). The full 60–80-node tree with Pew/Gallup
// mappings lands with calibration work; this covers what doorstep
// conversations in a local/county race actually surface. Slugs match what
// the extraction prompt exemplifies.
//
// KEEP IN SYNC with supabase/migrations/00000000000006_pilot_hardening.sql
// (the issues-table seed is generated from this list).

export interface IssueNode {
  id: string; // slug, snake_case — matches signals.top_issues values
  label: string;
  parentId?: string;
}

export const ISSUE_TAXONOMY: IssueNode[] = [
  // Economy & cost of living
  { id: "economy", label: "Economy" },
  { id: "cost_of_living", label: "Cost of living", parentId: "economy" },
  { id: "property_taxes", label: "Property taxes", parentId: "economy" },
  { id: "taxes", label: "Taxes (general)", parentId: "economy" },
  { id: "housing", label: "Housing & affordability", parentId: "economy" },
  { id: "jobs", label: "Jobs & wages", parentId: "economy" },
  { id: "small_business", label: "Small business", parentId: "economy" },

  // Services & infrastructure
  { id: "infrastructure", label: "Infrastructure" },
  { id: "roads", label: "Roads & traffic", parentId: "infrastructure" },
  { id: "transit", label: "Public transit", parentId: "infrastructure" },
  { id: "water", label: "Water", parentId: "infrastructure" },
  { id: "utilities", label: "Utilities & energy", parentId: "infrastructure" },
  { id: "development", label: "Growth & development", parentId: "infrastructure" },

  // Education
  { id: "education", label: "Education" },
  { id: "schools", label: "Public schools", parentId: "education" },
  { id: "school_funding", label: "School funding", parentId: "education" },
  { id: "higher_education", label: "Higher education", parentId: "education" },

  // Safety & justice
  { id: "public_safety", label: "Public safety" },
  { id: "crime", label: "Crime", parentId: "public_safety" },
  { id: "policing", label: "Policing", parentId: "public_safety" },
  { id: "border_security", label: "Border security", parentId: "public_safety" },
  { id: "drugs", label: "Drugs & opioids", parentId: "public_safety" },

  // Health & environment
  { id: "healthcare", label: "Healthcare" },
  { id: "abortion", label: "Abortion & reproductive rights", parentId: "healthcare" },
  { id: "seniors", label: "Seniors & retirement" },
  { id: "environment", label: "Environment" },
  { id: "climate", label: "Climate", parentId: "environment" },

  // Governance
  { id: "government_trust", label: "Trust in government" },
  { id: "elections", label: "Elections & voting" },
  { id: "immigration", label: "Immigration" },
  { id: "veterans", label: "Veterans" },
  { id: "homelessness", label: "Homelessness" },
];

export const ISSUE_IDS = new Set(ISSUE_TAXONOMY.map((i) => i.id));
