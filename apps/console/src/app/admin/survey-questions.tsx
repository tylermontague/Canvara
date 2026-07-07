"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface SurveyQuestion {
  id: string;
  question: string;
  options: string[];
  active: boolean;
  position: number;
}

export function SurveyQuestions({
  questions,
  campaignId,
  canEdit,
}: {
  questions: SurveyQuestion[];
  campaignId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function addQuestion() {
    setError(null);
    const text = question.trim();
    const options = optionsText
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    if (!text) {
      setError("Question text is required.");
      return;
    }
    if (options.length < 2) {
      setError("Provide at least two comma-separated options.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const maxPosition = questions.reduce((max, q) => Math.max(max, q.position), 0);
      const { error: insertError } = await supabase.from("survey_questions").insert({
        campaign_id: campaignId,
        question: text,
        options,
        position: maxPosition + 1,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setQuestion("");
      setOptionsText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add question.");
    } finally {
      setBusy(false);
    }
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
                <p className="text-sm text-ink">{q.question}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <span
                      key={opt}
                      className="rounded-lg bg-stone px-2.5 py-1 text-xs text-ink"
                    >
                      {opt}
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
