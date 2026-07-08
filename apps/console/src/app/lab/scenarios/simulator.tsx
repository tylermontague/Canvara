"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STANDING_DIMENSIONS,
  projectScenario,
  solveRequiredShare,
  solveRequiredTurnout,
  type ScenarioAssumptions,
  type SegmentAssumption,
  type SolveResult,
} from "@canvara/shared";
import { saveScenario, deleteScenario } from "./actions";

type BaselineSource = "door" | "poll" | "assumed";
type TurnoutSource = "history" | "assumed";

export interface ScenarioSegmentSeed {
  key: string;
  label: string;
  registered: number;
  turnoutPct: number;
  ourSharePct: number;
  baselineSource: BaselineSource;
  turnoutSource: TurnoutSource;
}

export interface SavedScenarioRow {
  id: string;
  name: string;
  notes: string | null;
  dimension: string;
  assumptions: ScenarioAssumptions;
  created_at: string;
}

interface SimulatorProps {
  dimension: string;
  initialSegments: ScenarioSegmentSeed[];
  savedScenarios: SavedScenarioRow[];
}

type SegmentValues = Record<string, { turnoutPct: number; ourSharePct: number }>;

const DIMENSION_LABELS = new Map(STANDING_DIMENSIONS.map((d) => [d.key, d.label]));

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function seedValues(segments: ScenarioSegmentSeed[]): SegmentValues {
  const values: SegmentValues = {};
  for (const s of segments) {
    values[s.key] = { turnoutPct: s.turnoutPct, ourSharePct: s.ourSharePct };
  }
  return values;
}

function parseElectorate(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function baselineTag(source: BaselineSource): string {
  if (source === "door") return "from door data";
  if (source === "poll") return "from poll prior";
  return "assumed even — insufficient data";
}

function turnoutTag(source: TurnoutSource): string {
  return source === "history" ? "turnout from history" : "turnout assumed";
}

/** Shared "requiredPct < 0" clamp-and-note rule for the what-if statements. */
function displayPct(requiredPct: number): { text: string; note: string } {
  const clamped = Math.max(0, requiredPct);
  return { text: clamped.toFixed(1), note: requiredPct < 0 ? " (any turnout/share wins)" : "" };
}

function shareStatement(result: SolveResult | null, label: string): string {
  if (result === null) return "This segment casts no votes under current assumptions.";
  if (!result.attainable) return "Not attainable — even 100% of this segment doesn't get there.";
  const { text, note } = displayPct(result.requiredPct);
  return `To break even, you need more than ${text}% of ${label} at their assumed turnout.${note}`;
}

function turnoutStatement(result: SolveResult | null, label: string): string {
  if (result === null) return "Turnout of this segment can't decide the race (50/50 share).";
  if (!result.attainable) {
    return result.direction === "min"
      ? "Not attainable — even 100% turnout here doesn't get there."
      : "Not attainable — even 0% turnout here doesn't save this segment.";
  }
  const { text, note } = displayPct(result.requiredPct);
  if (result.direction === "min") {
    return `For this to matter, ${label}'s turnout must exceed ${text}% at your assumed share.${note}`;
  }
  return `You can only afford up to ${text}% turnout in ${label} (you're losing this segment).${note}`;
}

function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
          {label}
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), 0, 100))}
          className="w-16 rounded border border-rule bg-white px-1.5 py-0.5 text-right text-xs text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-navy"
      />
    </div>
  );
}

export function Simulator({ dimension, initialSegments, savedScenarios }: SimulatorProps) {
  const router = useRouter();
  const [values, setValues] = useState<SegmentValues>(() => seedValues(initialSegments));
  const [expectedElectorateInput, setExpectedElectorateInput] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setSegmentValue(key: string, field: "turnoutPct" | "ourSharePct", value: number) {
    setValues((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function reset() {
    setValues(seedValues(initialSegments));
    setExpectedElectorateInput("");
  }

  function loadScenario(scenario: SavedScenarioRow) {
    if (scenario.dimension !== dimension) return;
    const next: SegmentValues = { ...values };
    for (const s of scenario.assumptions.segments) {
      next[s.key] = { turnoutPct: s.turnoutPct, ourSharePct: s.ourSharePct };
    }
    setValues(next);
    setExpectedElectorateInput(
      scenario.assumptions.expectedElectorate != null
        ? String(scenario.assumptions.expectedElectorate)
        : "",
    );
  }

  const currentAssumptions: SegmentAssumption[] = useMemo(
    () =>
      initialSegments.map((s) => ({
        key: s.key,
        label: s.label,
        registered: s.registered,
        turnoutPct: values[s.key]?.turnoutPct ?? s.turnoutPct,
        ourSharePct: values[s.key]?.ourSharePct ?? s.ourSharePct,
      })),
    [initialSegments, values],
  );

  const expectedElectorate = parseElectorate(expectedElectorateInput);
  const projection = useMemo(
    () => projectScenario(currentAssumptions, { expectedElectorate }),
    [currentAssumptions, expectedElectorate],
  );

  const shareResult =
    targetKey !== "" ? solveRequiredShare(currentAssumptions, targetKey, { expectedElectorate }) : null;
  const turnoutResult =
    targetKey !== ""
      ? solveRequiredTurnout(currentAssumptions, targetKey, { expectedElectorate })
      : null;
  const targetLabel = initialSegments.find((s) => s.key === targetKey)?.label ?? "";

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    try {
      const result = await saveScenario({
        name,
        dimension,
        notes: notes.trim() === "" ? null : notes,
        assumptions: {
          dimension,
          segments: currentAssumptions,
          expectedElectorate: expectedElectorate ?? null,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const result = await deleteScenario(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-rule bg-white p-5">
        <h2 className="mb-4 font-serif text-lg font-bold text-navy">What-if simulator</h2>

        <div className="space-y-4">
          {initialSegments.map((seed) => {
            const v = values[seed.key] ?? { turnoutPct: seed.turnoutPct, ourSharePct: seed.ourSharePct };
            return (
              <div key={seed.key} className="rounded-lg border border-rule p-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <p className="text-sm font-medium text-ink">{seed.label}</p>
                  <p className="text-xs text-slate">
                    {seed.registered.toLocaleString()} registered
                  </p>
                </div>
                <p className="mb-3 text-xs text-slate">
                  {baselineTag(seed.baselineSource)} · {turnoutTag(seed.turnoutSource)}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SliderField
                    label="Turnout %"
                    value={v.turnoutPct}
                    onChange={(value) => setSegmentValue(seed.key, "turnoutPct", value)}
                  />
                  <SliderField
                    label="Our share %"
                    value={v.ourSharePct}
                    onChange={(value) => setSegmentValue(seed.key, "ourSharePct", value)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="sm:max-w-sm">
            <label className="mb-1 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
              Expected total votes cast
            </label>
            <input
              type="number"
              min={0}
              value={expectedElectorateInput}
              onChange={(e) => setExpectedElectorateInput(e.target.value)}
              placeholder="leave blank to derive from turnout assumptions"
              className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
            />
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-rule bg-white px-4 py-2 text-sm text-navy transition-colors duration-200 ease-out hover:bg-stone"
          >
            Reset to baseline
          </button>
        </div>
      </div>

      {/* Live projection */}
      <div className="rounded-xl bg-navy p-5 text-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-serif text-xl font-bold">
            Projected: {projection.win ? "WIN" : "LOSE"} by{" "}
            {Math.round(Math.abs(projection.margin)).toLocaleString()} votes
          </p>
          <p className="text-sm text-white/70">
            win number {Math.round(projection.winNumber).toLocaleString()}
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Our votes", value: Math.round(projection.ourVotes).toLocaleString() },
            { label: "Their votes", value: Math.round(projection.theirVotes).toLocaleString() },
            { label: "Total cast", value: Math.round(projection.totalCast).toLocaleString() },
            {
              label: "Margin",
              value: `${projection.margin >= 0 ? "+" : ""}${Math.round(projection.margin).toLocaleString()}`,
            },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] font-medium tracking-[0.08em] text-white/60 uppercase">
                {stat.label}
              </p>
              <p className="font-mono text-lg">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* What would it take */}
      <div className="rounded-xl border border-rule bg-white p-5">
        <h2 className="mb-3 font-serif text-lg font-bold text-navy">What would it take?</h2>
        <select
          value={targetKey}
          onChange={(e) => setTargetKey(e.target.value)}
          className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold sm:w-72"
        >
          <option value="">Choose a segment…</option>
          {initialSegments.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {targetKey !== "" && (
          <div className="mt-3 space-y-2 text-sm text-ink">
            <p>{shareStatement(shareResult, targetLabel)}</p>
            <p>{turnoutStatement(turnoutResult, targetLabel)}</p>
          </div>
        )}
      </div>

      {/* Save scenario */}
      <div className="rounded-xl border border-rule bg-white p-5">
        <h2 className="mb-3 font-serif text-lg font-bold text-navy">Save this scenario</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="flex-1 rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save scenario"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Saved scenarios */}
      <div className="rounded-xl border border-rule bg-white p-5">
        <h2 className="mb-3 font-serif text-lg font-bold text-navy">Saved scenarios</h2>
        {savedScenarios.length === 0 ? (
          <p className="text-sm text-slate">No saved scenarios yet.</p>
        ) : (
          <div className="space-y-3">
            {savedScenarios.map((s) => {
              const matches = s.dimension === dimension;
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{s.name}</p>
                    <p className="text-xs text-slate">
                      {new Date(s.created_at).toLocaleDateString()} ·{" "}
                      {matches
                        ? "this dimension"
                        : `saved under ${DIMENSION_LABELS.get(s.dimension) ?? s.dimension}`}
                    </p>
                    {s.notes && <p className="mt-1 text-xs text-slate">{s.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadScenario(s)}
                      disabled={!matches}
                      className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(s.id)}
                      disabled={busy}
                      className="rounded-lg border border-rule bg-white px-3 py-1.5 text-xs text-navy transition-colors duration-200 ease-out hover:bg-stone disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
