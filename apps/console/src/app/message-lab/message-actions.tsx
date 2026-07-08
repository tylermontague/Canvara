"use client";

import { useState, useTransition } from "react";
import { setMessageStatus } from "./actions";

export function MessageActions({ messageId }: { messageId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(status: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await setMessageStatus(messageId, status);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handle("approved")}
          disabled={isPending}
          className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => handle("rejected")}
          disabled={isPending}
          className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
