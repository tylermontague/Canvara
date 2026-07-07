"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseCsv,
  detectHeaderRow,
  suggestMapping,
  mapRows,
  VOTER_FIELDS,
  type ColumnMapping,
  type VoterFieldKey,
} from "@canvara/shared";
import { createClient } from "@/lib/supabase/client";

const BATCH_SIZE = 500;
const PREVIEW_ROWS = 12;
const ADDRESS_SLOTS = 3;

type Phase =
  | { step: "upload" }
  | { step: "configure" }
  | { step: "importing"; done: number; total: number }
  | { step: "complete"; imported: number; skipped: number }
  | { step: "error"; message: string };

export function ImportWizard() {
  const router = useRouter();
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [phase, setPhase] = useState<Phase>({ step: "upload" });

  const header = rows[headerRow] ?? [];
  const columnLabel = (i: number) =>
    header[i]?.trim() ? `${header[i]} (col ${i + 1})` : `column ${i + 1}`;

  const mapped = useMemo(
    () => (rows.length > 0 ? mapRows(rows, headerRow, mapping) : null),
    [rows, headerRow, mapping],
  );

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setPhase({ step: "error", message: "That file has no data rows." });
      return;
    }
    const detected = detectHeaderRow(parsed);
    setRows(parsed);
    setFileName(file.name);
    setHeaderRow(detected);
    setMapping(suggestMapping(parsed[detected]));
    setPhase({ step: "configure" });
  }

  function selectHeaderRow(i: number) {
    setHeaderRow(i);
    setMapping(suggestMapping(rows[i]));
  }

  function setSingle(field: VoterFieldKey, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[field];
      else next[field] = [parseInt(value, 10)];
      return next;
    });
  }

  function setAddressSlot(slot: number, value: string) {
    setMapping((m) => {
      const cols = [...(m.address ?? [])];
      if (value === "") cols.splice(slot, 1);
      else cols[slot] = parseInt(value, 10);
      const cleaned = cols.filter((c) => c !== undefined);
      const next = { ...m };
      if (cleaned.length === 0) delete next.address;
      else next.address = cleaned;
      return next;
    });
  }

  async function runImport() {
    if (!mapped || mapped.voters.length === 0) return;
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPhase({ step: "error", message: "Not signed in." });
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("campaign_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) {
      setPhase({ step: "error", message: "Could not load your campaign profile." });
      return;
    }

    const voters = mapped.voters.map((v) => ({ ...v, campaign_id: profile.campaign_id }));
    setPhase({ step: "importing", done: 0, total: voters.length });

    for (let i = 0; i < voters.length; i += BATCH_SIZE) {
      const batch = voters.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("voters").insert(batch);
      if (error) {
        setPhase({
          step: "error",
          message: `Import failed at row ${i + 1}: ${error.message}. ${i} rows were imported before the failure.`,
        });
        return;
      }
      setPhase({ step: "importing", done: Math.min(i + BATCH_SIZE, voters.length), total: voters.length });
    }

    setPhase({ step: "complete", imported: voters.length, skipped: mapped.skipped });
    router.refresh();
  }

  // ---------- render ----------

  if (phase.step === "upload" || phase.step === "error") {
    return (
      <div className="max-w-xl space-y-4">
        {phase.step === "error" && (
          <p className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
            {phase.message}
          </p>
        )}
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-zinc-700 p-10 text-center hover:border-zinc-500">
          <span className="text-zinc-300">Choose a CSV file…</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
        <p className="text-xs text-zinc-500">
          Disclaimers, preamble rows, and split headers are handled — you&apos;ll confirm the
          header row and column mapping before anything is imported.
        </p>
      </div>
    );
  }

  if (phase.step === "importing") {
    const pct = Math.round((phase.done / phase.total) * 100);
    return (
      <div className="max-w-xl space-y-3">
        <p className="text-sm text-zinc-300">
          Importing {phase.total.toLocaleString()} voters… {phase.done.toLocaleString()} done
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-zinc-100 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (phase.step === "complete") {
    return (
      <div className="max-w-xl space-y-4">
        <p className="rounded-md border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">
          Imported {phase.imported.toLocaleString()} voters
          {phase.skipped > 0 ? ` (${phase.skipped} empty rows skipped)` : ""}.
        </p>
        <div className="flex gap-3">
          <a href="/voters" className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900">
            View voters
          </a>
          <button
            onClick={() => {
              setRows([]);
              setPhase({ step: "upload" });
            }}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // configure
  const singleFields = VOTER_FIELDS.filter((f) => !f.multi);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 font-medium">
          1. Header row <span className="text-sm font-normal text-zinc-500">({fileName})</span>
        </h2>
        <p className="mb-2 text-sm text-zinc-400">
          Click the row that contains the column names. Rows above it are ignored.
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-xs">
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                <tr
                  key={i}
                  onClick={() => selectHeaderRow(i)}
                  className={`cursor-pointer border-t border-zinc-800/60 first:border-t-0 ${
                    i === headerRow
                      ? "bg-zinc-100 text-zinc-900"
                      : i < headerRow
                        ? "text-zinc-600 hover:bg-zinc-900"
                        : "hover:bg-zinc-900"
                  }`}
                >
                  <td className="px-2 py-1 font-mono text-[10px] opacity-60">{i + 1}</td>
                  {row.slice(0, 12).map((cell, j) => (
                    <td key={j} className="max-w-32 truncate px-2 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-medium">2. Column mapping</h2>
        <p className="mb-3 text-sm text-zinc-400">
          Suggested from the header names — adjust as needed. Unmapped fields import as blank.
        </p>
        <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {singleFields.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-300">{f.label}</span>
              <select
                value={mapping[f.key]?.[0] ?? ""}
                onChange={(e) => setSingle(f.key, e.target.value)}
                className="w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
              >
                <option value="">— not in file —</option>
                {header.map((_, i) => (
                  <option key={i} value={i}>
                    {columnLabel(i)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {Array.from({ length: ADDRESS_SLOTS }).map((_, slot) => (
            <label key={`addr-${slot}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-300">
                Street address{slot > 0 ? ` (part ${slot + 1})` : ""}
              </span>
              <select
                value={mapping.address?.[slot] ?? ""}
                onChange={(e) => setAddressSlot(slot, e.target.value)}
                className="w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
              >
                <option value="">{slot === 0 ? "— not in file —" : "— none —"}</option>
                {header.map((_, i) => (
                  <option key={i} value={i}>
                    {columnLabel(i)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-medium">3. Preview & import</h2>
        {mapped && (
          <>
            <p className="mb-2 text-sm text-zinc-400">
              {mapped.voters.length.toLocaleString()} voters ready
              {mapped.skipped > 0 ? ` · ${mapped.skipped} empty rows will be skipped` : ""}
            </p>
            <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-900 text-left text-zinc-400">
                  <tr>
                    {VOTER_FIELDS.map((f) => (
                      <th key={f.key} className="px-2 py-1.5 font-medium">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapped.voters.slice(0, 5).map((v, i) => (
                    <tr key={i} className="border-t border-zinc-800/60">
                      {VOTER_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-1.5">
                          {v[f.key] ?? <span className="text-zinc-600">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => void runImport()}
              disabled={mapped.voters.length === 0}
              className="rounded-md bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            >
              Import {mapped.voters.length.toLocaleString()} voters
            </button>
          </>
        )}
      </section>
    </div>
  );
}
