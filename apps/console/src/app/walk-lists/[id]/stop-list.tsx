"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Stop {
  id: string;
  position: number;
  status: string;
  voters: {
    first_name: string | null;
    last_name: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    party: string | null;
  } | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "text-zinc-400",
  visited: "text-emerald-400",
  not_home: "text-amber-400",
  skipped: "text-zinc-500",
  rescheduled: "text-sky-400",
};

export function StopList({ items }: { items: Stop[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const a = items[index];
    const b = items[target];
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("walk_list_items").update({ position: b.position }).eq("id", a.id),
      supabase.from("walk_list_items").update({ position: a.position }).eq("id", b.id),
    ]);
    setBusy(false);
    if (e1 || e2) {
      setError((e1 ?? e2)!.message);
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-zinc-500">This walk list has no stops.</p>;
  }

  return (
    <div className="max-w-3xl">
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <ol className="overflow-hidden rounded-lg border border-zinc-800">
        {items.map((stop, i) => (
          <li
            key={stop.id}
            className="flex items-center gap-3 border-t border-zinc-800/60 px-4 py-2 first:border-t-0"
          >
            <span className="w-8 text-right font-mono text-sm text-zinc-500">
              {stop.position}
            </span>
            <div className="flex-1">
              <div className="text-sm">
                {stop.voters?.last_name}, {stop.voters?.first_name}
                {stop.voters?.party && (
                  <span className="ml-2 text-xs text-zinc-500">({stop.voters.party})</span>
                )}
              </div>
              <div className="text-xs text-zinc-400">
                {stop.voters?.address}, {stop.voters?.city} {stop.voters?.zip}
              </div>
            </div>
            <span className={`text-xs ${STATUS_STYLES[stop.status] ?? "text-zinc-400"}`}>
              {stop.status.replace("_", " ")}
            </span>
            <div className="flex flex-col">
              <button
                onClick={() => void move(i, -1)}
                disabled={busy || i === 0}
                className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => void move(i, 1)}
                disabled={busy || i === items.length - 1}
                className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
