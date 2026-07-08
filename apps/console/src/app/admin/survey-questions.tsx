"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  QUESTION_KINDS,
  INTENTION_OPTIONS,
  INTENTION_LABELS,
  RANK_TOP_N,
  ISSUE_TAXONOMY,
  type QuestionKind,
} from "@canvara/shared";
import { createSurveyQuestion } from "./actions";

interface SurveyQuestion {
  id: string;
  question: string;
  options: string[];
  kind: string;
  active: boolean;
  position: number;
}

const KIND_BADGE: Record<string, string> = {
  choice: "Choice",
  intention: "Cold test",
  rank: "Issue rank",
};

const RANK_MIN_ISSUES = 3;
const RANK_MAX_ISSUES = 8;

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="rounded-full border border-rule bg-stone px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-slate uppercase">
      {KIND_BADGE[kind] ?? kind}
    </span>
  );
}

export function SurveyQuestions({
  questions,
  canEdit,
}: {
  questions: SurveyQuestion[];
  campaignId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<QuestionKind>("choice");
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [issueIds, setIssueIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeIntentionExists = questions.some((q) => q.kind === "intention" && q.active);

  async function toggleActive(q: SurveyQuestion) {
    setToggling(q.id);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("survey_questions")
      .update({ active: !q.active })
      .eq("id", q.id);
    setToggling(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  function toggleIssue(id: string) {
    setIssueIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= RANK_MAX_ISSUES) return prev;
      return [...prev, id];
    });
  }

  function resetForm() {
    setQuestion("");
    setOptionsText("");
    setIssueIds([]);
  }

  async function addQuestion() {
    setError(null);
    const text = question.trim();
    if (!text) {
      setError("Question text is required.");
      return;
    }

    let options: string[] | undefined;
    if (kind === "choice") {
      options = optionsText
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      if (options.length < 2) {
        setError("Provide at least two comma-separated options.");
        return;
      }
    } else if (kind === "rank") {
      if (issueIds.length < RANK_MIN_ISSUES || issueIds.length > RANK_MAX_ISSUES) {
        setError(`Select ${RANK_MIN_ISSUES}–${RANK_MAX_ISSUES} issues (aim for about 5).`);
        return;
      }
      options = issueIds;
    }
    // 'intention' — options are fixed server-side.

    setBusy(true);
    try {
      const result = await createSurveyQuestion({ kind, question: text, options });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add question.");
    } finally {
      setBusy(false);
    }
  }

  const issueRoots = ISSUE_TAXONOMY.filter((i) => !i.parentId);
  const issueChildren = new Map<string, typeof ISSUE_TAXONOMY>();
  for (const node of ISSUE_TAXONOMY) {
    if (!node.parentId) continue;
    const list = issueChildren.get(node.parentId) ?? [];
    list.push(node);
    issueChildren.set(node.parentId, list);
  }

  return (
    <div className="space-y-4">
      {questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((q) => (
            <div
              key={q.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-rule p-3"
            >
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <KindBadge kind={q.kind} />
                  <p className="text-sm text-ink">{q.question}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.kind === "intention"
                    ? INTENTION_OPTIONS.map((opt) => (
                        <span
                          key={opt}
                          className="rounded-lg bg-stone px-2.5 py-1 text-xs text-ink"
                        >
                          {INTENTION_LABELS[opt]}
                        </span>
                      ))
                    : q.options.map((opt, i) => (
                        <span
                          key={opt}
                          className="rounded-lg bg-stone px-2.5 py-1 text-xs text-ink"
                        >
                          {q.kind === "rank"
                            ? `${i + 1}. ${opt.replace(/_/g, " ")}`
                            : opt}
                        </span>
                      ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-slate">{q.active ? "active" : "inactive"}</span>
                {canEdit && (
                  <button
                    onClick={() => void toggleActive(q)}
                    disabled={toggling === q.id}
                    className="text-sm text-navy underline-offset-2 transition-colors duration-200 ease-out hover:underline disabled:opacity-50"
                  >
                    {q.active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate">No door poll questions yet.</p>
      )}

      {canEdit && (
        <div className="space-y-3 border-t border-rule pt-4">
          <div>
            <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
              Kind
            </label>
            <div className="flex flex-wrap gap-2">
              {QUESTION_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setError(null);
                  }}
                  className={
                    kind === k
                      ? "rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 ease-out"
                      : "rounded-lg border border-rule bg-white px-3 py-1.5 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
                  }
                >
                  {KIND_BADGE[k]}
                </button>
              ))}
            </div>
            {kind === "intention" && activeIntentionExists && (
              <p className="mt-2 text-xs text-slate">
                An active cold-test question already exists. Only one should be active at a
                time — this won&apos;t block you, but consider deactivating the other first.
              </p>
            )}
            {kind === "rank" && (
              <p className="mt-2 text-xs text-slate">
                Voters rank their top {RANK_TOP_N} of the issues you select here at the door.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-question"
              className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
            >
              Question
            </label>
            <input
              id="new-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Do you support the new library bond?"
              className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
            />
          </div>

          {kind === "choice" && (
            <div>
              <label
                htmlFor="new-options"
                className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
              >
                Options (comma-separated)
              </label>
              <input
                id="new-options"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="Yes, No, Unsure"
                className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
              />
            </div>
          )}

          {kind === "intention" && (
            <div>
              <p className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                Options (fixed protocol)
              </p>
              <div className="flex flex-wrap gap-2">
                {INTENTION_OPTIONS.map((opt) => (
                  <span
                    key={opt}
                    className="rounded-lg border border-rule bg-stone px-2.5 py-1 text-xs text-ink"
                  >
                    {INTENTION_LABELS[opt]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {kind === "rank" && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="block text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
                  Issues ({issueIds.length}/{RANK_MAX_ISSUES} selected — need {RANK_MIN_ISSUES}
                  –{RANK_MAX_ISSUES})
                </p>
                {issueIds.length > 0 && (
                  <p className="text-xs text-slate">
                    Order: {issueIds.map((id) => id.replace(/_/g, " ")).join(" → ")}
                  </p>
                )}
              </div>
              <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-rule p-3">
                {issueRoots.map((root) => (
                  <div key={root.id}>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={issueIds.includes(root.id)}
                        onChange={() => toggleIssue(root.id)}
                        disabled={!issueIds.includes(root.id) && issueIds.length >= RANK_MAX_ISSUES}
                      />
                      <span className="font-medium">{root.label}</span>
                    </label>
                    {(issueChildren.get(root.id) ?? []).length > 0 && (
                      <div className="mt-1 ml-6 grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {(issueChildren.get(root.id) ?? []).map((child) => (
                          <label key={child.id} className="flex items-center gap-2 text-sm text-ink">
                            <input
                              type="checkbox"
                              checked={issueIds.includes(child.id)}
                              onChange={() => toggleIssue(child.id)}
                              disabled={
                                !issueIds.includes(child.id) && issueIds.length >= RANK_MAX_ISSUES
                              }
                            />
                            {child.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={() => void addQuestion()}
            disabled={busy}
            className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add question"}
          </button>
        </div>
      )}
    </div>
  );
}
