"use client";

import { useState } from "react";
import { saveNarrative } from "./actions";

interface NarrativeShape {
  candidateName: string;
  pitch: string;
  story: string;
  values: string[];
  signatureIssues: string[];
  proofPoints: string[];
  tone: string;
  updatedAt: string | null;
}

/** A controlled list of text chips — add/remove entries for a string[] field. */
function ListEditor({
  label,
  items,
  placeholder,
  canEdit,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder?: string;
  canEdit: boolean;
  onChange: (items: string[]) => void;
}) {
  function updateItem(index: number, value: string) {
    onChange(items.map((v, i) => (i === index ? value : v)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([...items, ""]);
  }

  return (
    <div>
      <label className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase">
        {label}
      </label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={item}
              placeholder={placeholder}
              disabled={!canEdit}
              onChange={(e) => updateItem(i, e.target.value)}
              className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => removeItem(i)}
                aria-label={`Remove ${label.toLowerCase()} entry`}
                className="shrink-0 rounded-lg border border-rule bg-white px-2.5 py-2 text-sm text-slate transition-colors duration-200 ease-out hover:bg-stone hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={addItem}
          className="mt-2 text-sm text-navy underline-offset-2 transition-colors duration-200 ease-out hover:underline"
        >
          + add
        </button>
      )}
      {items.length === 0 && !canEdit && (
        <p className="text-sm text-slate italic">None yet.</p>
      )}
    </div>
  );
}

export function NarrativeForm({
  initial,
  canEdit,
}: {
  initial: NarrativeShape;
  canEdit: boolean;
}) {
  const [candidateName, setCandidateName] = useState(initial.candidateName);
  const [pitch, setPitch] = useState(initial.pitch);
  const [story, setStory] = useState(initial.story);
  const [values, setValues] = useState<string[]>(initial.values);
  const [signatureIssues, setSignatureIssues] = useState<string[]>(initial.signatureIssues);
  const [proofPoints, setProofPoints] = useState<string[]>(initial.proofPoints);
  const [tone, setTone] = useState(initial.tone);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);
  const [justSaved, setJustSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setJustSaved(false);
    setBusy(true);
    try {
      const result = await saveNarrative({
        candidateName,
        pitch,
        story,
        values,
        signatureIssues,
        proofPoints,
        tone,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedAt(new Date().toISOString());
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save narrative.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {!canEdit && (
        <p className="text-sm text-slate">
          Only campaign leadership can edit the narrative.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="candidate-name"
            className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
          >
            Candidate name
          </label>
          <input
            id="candidate-name"
            value={candidateName}
            disabled={!canEdit}
            onChange={(e) => setCandidateName(e.target.value)}
            className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
          />
        </div>
        <div>
          <label
            htmlFor="tone"
            className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
          >
            Voice / tone
          </label>
          <input
            id="tone"
            value={tone}
            placeholder="warm, plainspoken, optimistic"
            disabled={!canEdit}
            onChange={(e) => setTone(e.target.value)}
            className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="pitch"
          className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
        >
          One-line pitch
        </label>
        <input
          id="pitch"
          value={pitch}
          disabled={!canEdit}
          onChange={(e) => setPitch(e.target.value)}
          className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
        />
      </div>

      <div>
        <label
          htmlFor="story"
          className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
        >
          Story / backstory
        </label>
        <textarea
          id="story"
          rows={5}
          value={story}
          disabled={!canEdit}
          onChange={(e) => setStory(e.target.value)}
          className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-200 ease-out focus:border-gold disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
        />
      </div>

      <ListEditor
        label="Core values"
        items={values}
        placeholder="e.g. honesty, service, community"
        canEdit={canEdit}
        onChange={setValues}
      />

      <ListEditor
        label="Signature issues"
        items={signatureIssues}
        placeholder="e.g. affordable housing"
        canEdit={canEdit}
        onChange={setSignatureIssues}
      />

      <ListEditor
        label="Proof points / biographical hooks"
        items={proofPoints}
        placeholder="e.g. spent my whole life in this part of town"
        canEdit={canEdit}
        onChange={setProofPoints}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {justSaved && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Saved.
        </p>
      )}

      <div className="flex items-center gap-4">
        {canEdit && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save narrative"}
          </button>
        )}
        {savedAt && (
          <span className="text-xs text-slate">
            Last updated {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
