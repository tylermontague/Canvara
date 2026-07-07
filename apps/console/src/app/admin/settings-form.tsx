"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONSENT_MODES, type ConsentMode } from "@canvara/shared";
import { createClient } from "@/lib/supabase/client";

const CONSENT_MODE_LABELS: Record<ConsentMode, string> = {
  one_party: "One-party (standard disclosure)",
  two_party: "Two-party (stricter)",
};

const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

export function SettingsForm({
  campaignId,
  retentionDays,
  consentMode,
  canEdit,
}: {
  campaignId: string;
  retentionDays: number;
  consentMode: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [retention, setRetention] = useState(retentionDays);
  const [consent, setConsent] = useState<ConsentMode>(
    (CONSENT_MODES as readonly string[]).includes(consentMode)
      ? (consentMode as ConsentMode)
      : "one_party",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setError(null);
    setSuccess(false);

    if (retention < MIN_RETENTION_DAYS) {
      setError(`Retention must be at least ${MIN_RETENTION_DAYS} days.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const { data, error: updateError } = await supabase
        .from("campaigns")
        .update({ retention_days: retention, consent_mode: consent })
        .eq("id", campaignId)
        .select("id");

      if (updateError) {
        setError(updateError.message);
        return;
      }
      if (!data || data.length === 0) {
        setError("You don't have permission to change settings.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase.from("audit_log").insert({
        campaign_id: campaignId,
        actor_id: user?.id ?? null,
        action: "settings_updated",
        entity: "campaign",
        entity_id: campaignId,
        detail: { retention_days: retention, consent_mode: consent },
      });

      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="retention-days"
            className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
          >
            Retention (days)
          </label>
          <input
            id="retention-days"
            type="number"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            value={retention}
            disabled={!canEdit}
            onChange={(e) => setRetention(Number(e.target.value))}
            className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
          />
        </div>
        <div>
          <label
            htmlFor="consent-mode"
            className="mb-2 block text-[11px] font-medium tracking-[0.08em] text-slate uppercase"
          >
            Consent mode
          </label>
          <select
            id="consent-mode"
            value={consent}
            disabled={!canEdit}
            onChange={(e) => setConsent(e.target.value as ConsentMode)}
            className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm text-ink transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:bg-stone disabled:text-slate"
          >
            {CONSENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {CONSENT_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canEdit && (
        <p className="text-sm text-slate">
          Only admins and campaign managers can change settings.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {success && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Settings saved.
        </p>
      )}

      {canEdit && (
        <button
          onClick={() => void handleSave()}
          disabled={busy}
          className="rounded-lg bg-gold px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-gold-hover disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      )}
    </div>
  );
}
