"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseCsv,
  detectHeaderRow,
  suggestMapping,
  mapRows,
  VOTER_FIELDS,
  fetchExistingForMerge,
  planVoterImport,
  applyVoterImport,
  type ColumnMapping,
  type VoterFieldKey,
  type ImportPlan,
  type ApplyImportResult,
} from "@canvara/shared";
import { createClient } from "@/lib/supabase/client";

const PREVIEW_ROWS = 12;
const ADDRESS_SLOTS = 3;

type Phase =
  | { step: "upload" }
  | { step: "configure" }
  | { step: "preview"; plan: ImportPlan; campaignId: string; actorId: string; sourceLabel: string }
  | { step: "importing" }
  | { step: "complete"; result: ApplyImportResult }
  | { step: "error"; message: string };

export function ImportWizard() {
  const router = useRouter();
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [sourceLabel, setSourceLabel] = useState("");
  const [deactivateAbsent, setDeactivateAbsent] = useState(false);
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
    setSourceLabel(file.name);
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

  async function runPreview() {
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

    try {
      const existing = await fetchExistingForMerge(supabase, profile.campaign_id);
      const plan = planVoterImport(existing, mapped.voters, { deactivateAbsent });
      setPhase({
        step: "preview",
        plan,
        campaignId: profile.campaign_id,
        actorId: user.id,
        sourceLabel: sourceLabel.trim() || fileName || "Untitled import",
      });
    } catch (err) {
      setPhase({
        step: "error",
        message: err instanceof Error ? err.message : "Could not compute the merge preview.",
      });
    }
  }

  async function confirmMerge() {
    if (phase.step !== "preview" || !mapped) return;
    const { campaignId, actorId, sourceLabel: label } = phase;
    setPhase({ step: "importing" });
    const supabase = createClient();

    try {
      const result = await applyVoterImport(supabase, mapped.voters, {
        campaignId,
        actorId,
        sourceLabel: label,
        filename: fileName || null,
        mapping,
        deactivateAbsent,
      });
      setPhase({ step: "complete", result });
      router.refresh();
    } catch (err) {
      setPhase({
        step: "error",
        message: err instanceof Error ? err.message : "The merge failed.",
      });
    }
  }

  // ---------- render ----------

  if (phase.step === "upload" || phase.step === "error") {
    return (
      <div className="max-w-xl space-y-4">
        {phase.step === "error" && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {phase.message}
          </p>
        )}
        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-rule bg-white p-10 text-center transition-colors duration-200 ease-out hover:border-navy">
          <span className="text-navy">Choose a CSV file…</span>
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
        <p className="text-xs text-slate">
          Disclaimers, preamble rows, and split headers are handled — you&apos;ll confirm the
          header row and column mapping before anything is merged.
        </p>
      </div>
    );
  }

  if (phase.step === "importing") {
    return (
      <div className="max-w-xl space-y-3">
        <p className="text-sm text-ink">Merging…</p>
        <div className="h-2 overflow-hidden rounded-full bg-rule">
          <div className="h-full w-full animate-pulse bg-navy" />
        </div>
      </div>
    );
  }

  if (phase.step === "complete") {
    const { result } = phase;
    return (
      <div className="max-w-xl space-y-4">
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Merge complete: {result.counts.inserted.toLocaleString()} new,{" "}
          {result.counts.updated.toLocaleString()} updated,{" "}
          {result.counts.unchanged.toLocaleString()} unchanged,{" "}
          {result.counts.dropped.toLocaleString()} moved out,{" "}
          {result.counts.reactivated.toLocaleString()} returning
          {result.counts.unmergeable > 0
            ? ` (${result.counts.unmergeable} unmergeable rows skipped)`
            : ""}
          .
        </p>
        <div className="flex gap-3">
          <a
            href="/voters"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover"
          >
            View voters
          </a>
          <button
            onClick={() => {
              setRows([]);
              setSourceLabel("");
              setPhase({ step: "upload" });
            }}
            className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  if (phase.step === "preview") {
    const { plan } = phase;
    const tiles: { label: string; value: number }[] = [
      { label: "New voters", value: plan.counts.inserted },
      { label: "Updated", value: plan.counts.updated },
      { label: "Unchanged", value: plan.counts.unchanged },
      { label: "Moving out", value: plan.counts.dropped },
      { label: "Returning", value: plan.counts.reactivated },
    ];
    return (
      <div className="max-w-2xl space-y-5">
        <h2 className="font-serif text-lg font-bold text-navy">Merge preview</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-rule bg-white p-3 text-center">
              <div className="font-mono text-xl font-bold text-navy">
                {t.value.toLocaleString()}
              </div>
              <div className="mt-1 text-[11px] tracking-[0.04em] text-slate uppercase">
                {t.label}
              </div>
            </div>
          ))}
        </div>
        {plan.counts.unmergeable > 0 && (
          <p className="rounded-lg border border-rule bg-stone p-3 text-xs text-slate">
            {plan.counts.unmergeable} row{plan.counts.unmergeable === 1 ? "" : "s"} had no voter
            ID and can&apos;t be matched; they were skipped.
          </p>
        )}
        <div className="rounded-xl border border-navy/20 bg-navy/5 p-4">
          <p className="mb-1 text-sm font-semibold text-navy">
            Canvassing data is always preserved.
          </p>
          <p className="text-sm text-ink">
            Updating the file only refreshes name, address, party, and other file fields. Door
            conversations, observed attributes, beliefs, notes, and analysis are never touched.
            Voters who dropped off the new file are set aside (inactive), not deleted — their
            history stays.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void confirmMerge()}
            className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover"
          >
            Confirm &amp; merge
          </button>
          <button
            onClick={() => setPhase({ step: "configure" })}
            className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
          >
            Back
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
        <h2 className="mb-1 font-serif text-lg font-bold text-navy">
          1. Header row <span className="font-sans text-sm font-normal text-slate">({fileName})</span>
        </h2>
        <p className="mb-2 text-sm text-slate">
          Click the row that contains the column names. Rows above it are ignored.
        </p>
        <div className="overflow-x-auto rounded-xl border border-rule bg-white">
          <table className="w-full text-xs">
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                <tr
                  key={i}
                  onClick={() => selectHeaderRow(i)}
                  className={`cursor-pointer border-t border-rule transition-colors duration-200 ease-out first:border-t-0 ${
                    i === headerRow
                      ? "bg-navy text-white"
                      : i < headerRow
                        ? "text-slate hover:bg-stone"
                        : "hover:bg-stone"
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
        <h2 className="mb-1 font-serif text-lg font-bold text-navy">2. Column mapping</h2>
        <p className="mb-3 text-sm text-slate">
          Suggested from the header names — adjust as needed. Unmapped fields import as blank.
        </p>
        <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {singleFields.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink">{f.label}</span>
              <select
                value={mapping[f.key]?.[0] ?? ""}
                onChange={(e) => setSingle(f.key, e.target.value)}
                className="w-56 rounded-lg border border-rule bg-white px-2 py-1.5 text-ink"
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
              <span className="text-ink">
                Street address{slot > 0 ? ` (part ${slot + 1})` : ""}
              </span>
              <select
                value={mapping.address?.[slot] ?? ""}
                onChange={(e) => setAddressSlot(slot, e.target.value)}
                className="w-56 rounded-lg border border-rule bg-white px-2 py-1.5 text-ink"
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
        <h2 className="mb-1 font-serif text-lg font-bold text-navy">3. Merge</h2>
        {mapped && (
          <>
            <label className="mb-3 flex max-w-md items-center justify-between gap-3 text-sm">
              <span className="text-ink">Source label</span>
              <input
                type="text"
                value={sourceLabel}
                onChange={(e) => setSourceLabel(e.target.value)}
                placeholder={fileName}
                className="w-64 rounded-lg border border-rule bg-white px-2 py-1.5 text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
              />
            </label>
            <label className="mb-3 flex max-w-md items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={deactivateAbsent}
                onChange={(e) => setDeactivateAbsent(e.target.checked)}
                className="mt-0.5 accent-navy"
              />
              <span className="text-ink">
                This is my complete, current voter file.
                <span className="mt-0.5 block text-xs text-slate">
                  Mark voters missing from it as moved out (set aside, not deleted). Leave
                  unchecked for a partial or supplemental file so no one is retired by mistake.
                </span>
              </span>
            </label>
            <p className="mb-2 text-sm text-slate">
              {mapped.voters.length.toLocaleString()} voters ready
              {mapped.skipped > 0 ? ` · ${mapped.skipped} empty rows will be skipped` : ""}
            </p>
            <div className="mb-4 overflow-x-auto rounded-xl border border-rule bg-white">
              <table className="w-full text-xs">
                <thead className="text-left">
                  <tr>
                    {VOTER_FIELDS.map((f) => (
                      <th
                        key={f.key}
                        className="border-b border-rule px-2 py-1.5 text-[10px] font-medium tracking-[0.08em] text-slate uppercase"
                      >
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapped.voters.slice(0, 5).map((v, i) => (
                    <tr key={i} className="border-t border-rule">
                      {VOTER_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-1.5 text-ink">
                          {v[f.key] ?? <span className="text-slate">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => void runPreview()}
              disabled={mapped.voters.length === 0}
              className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
            >
              Preview merge
            </button>
          </>
        )}
      </section>
    </div>
  );
}
