"use client";

import { useState, useTransition } from "react";
import { approveSpark, retireSpark } from "./actions";

export function SparkDraftActions({ sparkId }: { sparkId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => handle(() => approveSpark(sparkId))}
        disabled={isPending}
        className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
      >
        Approve
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function SparkRetireAction({ sparkId }: { sparkId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    startTransition(async () => {
      const result = await retireSpark(sparkId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handle}
        disabled={isPending}
        className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
      >
        Retire
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
