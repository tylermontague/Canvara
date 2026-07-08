"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { generateForCohort, generateForVoter } from "./actions";

interface CohortOption {
  id: string;
  name: string;
}

interface IssueOption {
  id: string;
  label: string;
}

interface VoterHit {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

const GOALS: { value: string; label: string }[] = [
  { value: "persuade", label: "Persuade" },
  { value: "turnout", label: "Turnout" },
  { value: "introduce", label: "Introduce" },
];

const selectClasses =
  "w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold";

const labelClasses = "mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase";

export function GenerateForms({
  cohorts,
  issues,
}: {
  cohorts: CohortOption[];
  issues: IssueOption[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <CohortForm cohorts={cohorts} issues={issues} />
      <IndividualForm issues={issues} />
    </div>
  );
}

function CohortForm({ cohorts, issues }: { cohorts: CohortOption[]; issues: IssueOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await generateForCohort(formData);
      if (result.ok) {
        setSuccess(`Drafted ${result.count} message${result.count === 1 ? "" : "s"}.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-rule bg-white p-5">
      <h2 className="mb-3 font-serif text-lg font-bold text-navy">New cohort message</h2>
      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="cohort-select" className={labelClasses}>
            Cohort
          </label>
          <select id="cohort-select" name="cohortId" required disabled={isPending} className={selectClasses}>
            <option value="">Select a cohort</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cohort-goal" className={labelClasses}>
            Goal
          </label>
          <select id="cohort-goal" name="goal" required disabled={isPending} className={selectClasses}>
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cohort-issue" className={labelClasses}>
            Focus issue (optional)
          </label>
          <select id="cohort-issue" name="issue" disabled={isPending} className={selectClasses}>
            <option value="">No focus issue</option>
            {issues.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-800">{success}</p>}
        {isPending && (
          <p className="text-sm text-slate">Drafting + guardrailing… this takes up to a minute.</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
        >
          {isPending ? "Drafting…" : "Draft cohort messages"}
        </button>
      </form>
    </div>
  );
}

function IndividualForm({ issues }: { issues: IssueOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VoterHit[]>([]);
  const [selected, setSelected] = useState<VoterHit | null>(null);
  const [searching, setSearching] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("voters")
        .select("id, first_name, last_name")
        .ilike("last_name", `%${value.trim()}%`)
        .limit(10);
      setResults(data ?? []);
    } finally {
      setSearching(false);
    }
  }

  function selectVoter(voter: VoterHit) {
    setSelected(voter);
    setQuery(`${voter.first_name ?? ""} ${voter.last_name ?? ""}`.trim());
    setResults([]);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    if (!selected) {
      setError("Select a voter from the search results.");
      return;
    }
    formData.set("voterId", selected.id);
    startTransition(async () => {
      const result = await generateForVoter(formData);
      if (result.ok) {
        setSuccess(`Drafted ${result.count} message${result.count === 1 ? "" : "s"}.`);
        formRef.current?.reset();
        setSelected(null);
        setQuery("");
        setResults([]);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-rule bg-white p-5">
      <h2 className="mb-3 font-serif text-lg font-bold text-navy">New individual message</h2>
      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <div className="relative">
          <label htmlFor="voter-search" className={labelClasses}>
            Voter (search by last name)
          </label>
          <input
            id="voter-search"
            value={query}
            disabled={isPending}
            onChange={(e) => void handleQueryChange(e.target.value)}
            placeholder="e.g. Alvarez"
            autoComplete="off"
            className={selectClasses}
          />
          {searching && <p className="mt-1 text-xs text-slate">Searching…</p>}
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-rule bg-white shadow-none">
              {results.map((voter) => (
                <li key={voter.id}>
                  <button
                    type="button"
                    onClick={() => selectVoter(voter)}
                    className="block w-full px-3 py-2 text-left text-sm text-ink transition-colors duration-200 ease-out hover:bg-stone"
                  >
                    {voter.first_name} {voter.last_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <p className="mt-1 text-xs text-slate">
              Selected: {selected.first_name} {selected.last_name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="voter-goal" className={labelClasses}>
            Goal
          </label>
          <select id="voter-goal" name="goal" required disabled={isPending} className={selectClasses}>
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="voter-issue" className={labelClasses}>
            Focus issue (optional)
          </label>
          <select id="voter-issue" name="issue" disabled={isPending} className={selectClasses}>
            <option value="">No focus issue</option>
            {issues.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-800">{success}</p>}
        {isPending && (
          <p className="text-sm text-slate">Drafting + guardrailing… this takes up to a minute.</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Drafting…" : "Draft individual messages"}
        </button>
      </form>
    </div>
  );
}
