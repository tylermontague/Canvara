"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COHORT_DIMENSIONS, SENTIMENTS, type CohortDefinition } from "@canvara/shared";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@canvara/db";

interface IssueOption {
  issue: string;
  mentions: number;
}

function chipClasses(selected: boolean): string {
  return selected
    ? "rounded-lg bg-navy px-3 py-1.5 text-sm text-white transition-colors duration-200 ease-out"
    : "rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-ink transition-colors duration-200 ease-out hover:bg-stone";
}

export function CohortBuilder({ issues }: { issues: IssueOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [demographics, setDemographics] = useState<Record<string, string[]>>({});
  const [issueSlug, setIssueSlug] = useState("");
  const [sentiments, setSentiments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDemographic(dimensionKey: string, value: string) {
    setDemographics((prev) => {
      const current = prev[dimensionKey] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const copy = { ...prev };
      if (next.length === 0) {
        delete copy[dimensionKey];
      } else {
        copy[dimensionKey] = next;
      }
      return copy;
    });
  }

  function toggleSentiment(value: string) {
    setSentiments((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  const hasDemographics = Object.keys(demographics).length > 0;
  const hasIssueStance = issueSlug !== "" && sentiments.length > 0;

  async function handleCreate() {
    setError(null);

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!hasDemographics && !hasIssueStance) {
      setError("Select at least one demographic, or an issue stance with a sentiment.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("campaign_id")
        .eq("id", user.id)
        .single();
      if (!profile) {
        setError("Could not load your campaign profile.");
        return;
      }

      const definition: CohortDefinition = {};
      if (hasDemographics) definition.demographics = demographics;
      if (hasIssueStance) definition.issue_stances = [{ issue: issueSlug, sentiments }];

      const { error: insertError } = await supabase.from("cohorts").insert({
        campaign_id: profile.campaign_id,
        name: name.trim(),
        definition: definition as unknown as Json,
        created_by: user.id,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }

      router.push("/lab/cohorts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create cohort.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label
          htmlFor="cohort-name"
          className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
        >
          Name
        </label>
        <input
          id="cohort-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Women 45–64, negative on property taxes"
          className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
        />
      </div>

      <div className="space-y-4">
        {COHORT_DIMENSIONS.map((dimension) => (
          <div key={dimension.key}>
            <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
              {dimension.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {dimension.options.map((option) => {
                const selected = (demographics[dimension.key] ?? []).includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleDemographic(dimension.key, option.value)}
                    className={chipClasses(selected)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
          Issue stance (optional)
        </p>
        <select
          value={issueSlug}
          onChange={(e) => setIssueSlug(e.target.value)}
          className="mb-3 w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold sm:w-72"
        >
          <option value="">No issue selected</option>
          {issues.map((issue) => (
            <option key={issue.issue} value={issue.issue}>
              {issue.issue.replace(/_/g, " ")} ({issue.mentions})
            </option>
          ))}
        </select>
        {issueSlug !== "" && (
          <div className="flex flex-wrap gap-2">
            {SENTIMENTS.map((sentiment) => {
              const selected = sentiments.includes(sentiment);
              return (
                <button
                  key={sentiment}
                  type="button"
                  onClick={() => toggleSentiment(sentiment)}
                  className={chipClasses(selected)}
                >
                  {sentiment}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={() => void handleCreate()}
        disabled={busy}
        className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create cohort"}
      </button>
    </div>
  );
}
