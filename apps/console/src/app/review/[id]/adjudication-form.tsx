"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveReview,
  SUPPORT_LEVELS,
  PERSUADABILITY_LEVELS,
  EMOTIONAL_VALENCES,
  type DebriefCorrection,
  type CorrectableField,
} from "@canvara/shared";
import type { Json } from "@canvara/db";
import { createClient } from "@/lib/supabase/client";

interface InitialValues {
  support_level: string | null;
  persuadability: string | null;
  emotional_valence: string | null;
  top_issues: string[];
}

export function AdjudicationForm({
  reviewId,
  signalId,
  conversationId,
  campaignId,
  isOpen,
  initial,
}: {
  reviewId: string;
  signalId: string;
  conversationId: string;
  campaignId: string;
  isOpen: boolean;
  initial: InitialValues;
}) {
  const router = useRouter();
  const [support, setSupport] = useState(initial.support_level);
  const [persuadability, setPersuadability] = useState(initial.persuadability);
  const [valence, setValence] = useState(initial.emotional_valence);
  const [issues, setIssues] = useState(initial.top_issues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const corrections = useMemo<DebriefCorrection[]>(() => {
    const out: DebriefCorrection[] = [];
    const diff = (field: CorrectableField, from: Json, to: Json) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ field, from, to });
    };
    diff("support_level", initial.support_level, support);
    diff("persuadability", initial.persuadability, persuadability);
    diff("emotional_valence", initial.emotional_valence, valence);
    diff("top_issues", initial.top_issues, issues);
    return out;
  }, [initial, support, persuadability, valence, issues]);

  async function handleResolve() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in.");
      setBusy(false);
      return;
    }
    try {
      await resolveReview(supabase, {
        reviewId,
        signalId,
        conversationId,
        campaignId,
        actorId: user.id,
        corrections,
      });
      router.push("/review");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve.");
      setBusy(false);
    }
  }

  if (!isOpen) {
    return <p className="text-sm text-slate">This item has already been resolved.</p>;
  }

  return (
    <div className="space-y-5">
      <ChipGroup label="Support level" options={SUPPORT_LEVELS} value={support} onChange={setSupport} />
      <ChipGroup
        label="Persuadability"
        options={PERSUADABILITY_LEVELS}
        value={persuadability}
        onChange={setPersuadability}
      />
      <ChipGroup
        label="Emotional valence"
        options={EMOTIONAL_VALENCES}
        value={valence}
        onChange={setValence}
      />

      <div>
        <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
          Top issues — click to remove
        </p>
        <div className="flex flex-wrap gap-2">
          {issues.map((issue) => (
            <button
              key={issue}
              onClick={() => setIssues((prev) => prev.filter((i) => i !== issue))}
              className="rounded-lg bg-navy px-3 py-1.5 text-sm text-white transition-colors duration-200 ease-out hover:bg-navy-light"
            >
              {issue.replace(/_/g, " ")} ✕
            </button>
          ))}
          {issues.length === 0 && <p className="text-sm text-slate">No issues recorded.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={() => void handleResolve()}
        disabled={busy}
        className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
      >
        {busy
          ? "Resolving…"
          : corrections.length > 0
            ? `Resolve with ${corrections.length} correction${corrections.length === 1 ? "" : "s"}`
            : "Accept extraction & resolve"}
      </button>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-slate uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors duration-200 ease-out ${
                active
                  ? "border-navy bg-navy text-white"
                  : "border-rule bg-white text-ink hover:bg-stone"
              }`}
            >
              {opt.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
