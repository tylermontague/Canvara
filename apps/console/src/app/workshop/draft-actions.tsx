"use client";

import { useState, useTransition } from "react";
import { approveQuestionDraft, dismissQuestionDraft } from "./actions";

export function QuestionDraftActions({
  draftId,
  question,
  options,
  flagged,
}: {
  draftId: string;
  question: string;
  options: string[];
  flagged: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveQuestionDraft(draftId, question, options);
      if (!result.ok) setError(result.error);
    });
  }

  function handleDismiss() {
    setError(null);
    startTransition(async () => {
      const result = await dismissQuestionDraft(draftId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-2">
      {flagged && (
        <p className="mb-2 text-xs text-red-700">
          This question was flagged by the neutrality guardrail. Approving it adds it to door
          polls anyway — only do this if a human has reviewed the wording.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={isPending}
          className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
        >
          Approve → add to door polls
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
