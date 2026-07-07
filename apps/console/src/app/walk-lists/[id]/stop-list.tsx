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
  pending: "text-slate",
  visited: "text-green-700",
  not_home: "text-amber-700",
  skipped: "text-slate",
  rescheduled: "text-navy",
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
    return <p className="text-slate">This walk list has no stops.</p>;
  }

  return (
    <div className="max-w-3xl">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <ol className="overflow-hidden rounded-xl border border-rule bg-white">
        {items.map((stop, i) => (
          <li
            key={stop.id}
            className="flex items-center gap-3 border-t border-rule px-4 py-2 first:border-t-0"
          >
            <span className="w-8 text-right font-mono text-sm text-slate">
              {stop.position}
            </span>
            <div className="flex-1">
              <div className="text-sm text-ink">
                {stop.voters?.last_name}, {stop.voters?.first_name}
                {stop.voters?.party && (
                  <span className="ml-2 text-xs text-slate">({stop.voters.party})</span>
                )}
              </div>
              <div className="text-xs text-slate">
                {stop.voters?.address}, {stop.voters?.city} {stop.voters?.zip}
              </div>
            </div>
            <span className={`text-xs ${STATUS_STYLES[stop.status] ?? "text-slate"}`}>
              {stop.status.replace("_", " ")}
            </span>
            <div className="flex flex-col">
              <button
                onClick={() => void move(i, -1)}
                disabled={busy || i === 0}
                className="px-1 text-slate transition-colors duration-200 ease-out hover:text-navy disabled:opacity-30"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => void move(i, 1)}
                disabled={busy || i === items.length - 1}
                className="px-1 text-slate transition-colors duration-200 ease-out hover:text-navy disabled:opacity-30"
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
