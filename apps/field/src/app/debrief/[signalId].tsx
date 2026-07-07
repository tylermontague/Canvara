// Debrief confirm/correct (FA-5): AI summary + tappable field chips.
// Target: under 45 seconds from open to confirm. Corrections are logged
// as training data (IE-8) via the shared submitDebrief helper.

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  submitDebrief,
  SUPPORT_LEVELS,
  PERSUADABILITY_LEVELS,
  EMOTIONAL_VALENCES,
  type DebriefCorrection,
  type CorrectableField,
} from "@canvara/shared";
import type { Json } from "@canvara/db";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

interface LoadedSignal {
  id: string;
  conversation_id: string;
  campaign_id: string;
  debrief_summary: string | null;
  support_level: string | null;
  persuadability: string | null;
  emotional_valence: string | null;
  top_issues: string[];
  voterName: string;
  voterId: string | null;
}

// Attributes a canvasser can sharpen at the door (M6.5). Door observation
// trumps the voter file in cohort evaluation.
const OBSERVABLE_ATTRIBUTES: { key: string; label: string; options: string[] }[] = [
  { key: "religiosity", label: "Religiosity", options: ["religious", "secular"] },
  {
    key: "race",
    label: "Race / ethnicity",
    options: ["white", "black", "hispanic", "asian", "native", "other"],
  },
  { key: "language", label: "Preferred language", options: ["english", "spanish", "other"] },
  { key: "education", label: "Education", options: ["no_college", "college", "postgrad"] },
];

export default function DebriefScreen() {
  const { signalId } = useLocalSearchParams<{ signalId: string }>();
  const { profile } = useSession();
  const [signal, setSignal] = useState<LoadedSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Editable state, seeded from the extraction.
  const [support, setSupport] = useState<string | null>(null);
  const [persuadability, setPersuadability] = useState<string | null>(null);
  const [valence, setValence] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [observed, setObserved] = useState<Record<string, string>>({});

  useEffect(() => {
    void supabase
      .from("signals")
      .select(
        "id, conversation_id, campaign_id, debrief_summary, support_level, persuadability, emotional_valence, top_issues, conversations!inner(voter_id, voters(first_name, last_name))",
      )
      .eq("id", signalId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setError(error?.message ?? "Signal not found.");
          return;
        }
        const voter = data.conversations.voters;
        const loaded: LoadedSignal = {
          id: data.id,
          conversation_id: data.conversation_id,
          campaign_id: data.campaign_id,
          debrief_summary: data.debrief_summary,
          support_level: data.support_level,
          persuadability: data.persuadability,
          emotional_valence: data.emotional_valence,
          top_issues: data.top_issues ?? [],
          voterName: voter
            ? `${voter.first_name ?? ""} ${voter.last_name ?? ""}`.trim()
            : "Unmatched door",
          voterId: data.conversations.voter_id,
        };
        setSignal(loaded);
        setSupport(loaded.support_level);
        setPersuadability(loaded.persuadability);
        setValence(loaded.emotional_valence);
        setIssues(loaded.top_issues);
      });
  }, [signalId]);

  const corrections = useMemo<DebriefCorrection[]>(() => {
    if (!signal) return [];
    const out: DebriefCorrection[] = [];
    const diff = (field: CorrectableField, from: Json, to: Json) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ field, from, to });
    };
    diff("support_level", signal.support_level, support);
    diff("persuadability", signal.persuadability, persuadability);
    diff("emotional_valence", signal.emotional_valence, valence);
    diff("top_issues", signal.top_issues, issues);
    return out;
  }, [signal, support, persuadability, valence, issues]);

  async function handleSubmit() {
    if (!signal || !profile) return;
    setBusy(true);
    setError(null);
    try {
      await submitDebrief(supabase, {
        signalId: signal.id,
        conversationId: signal.conversation_id,
        campaignId: signal.campaign_id,
        actorId: profile.id,
        corrections,
      });
      // Door-observed attributes (M6.5): what the canvasser learned in
      // person overrides the voter file downstream.
      const attributeRows = Object.entries(observed);
      if (signal.voterId && attributeRows.length > 0) {
        const { error: attrErr } = await supabase.from("voter_attributes").upsert(
          attributeRows.map(([key, value]) => ({
            campaign_id: signal.campaign_id,
            voter_id: signal.voterId!,
            key,
            value,
            source: "canvasser",
            noted_by: profile.id,
            conversation_id: signal.conversation_id,
          })),
          { onConflict: "voter_id,key" },
        );
        if (attrErr) throw new Error(attrErr.message);
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed — are you online?");
      setBusy(false);
    }
  }

  if (!signal) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>{error ?? "Loading…"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 18 }}>
      <View style={styles.card}>
        <Text style={styles.voter}>{signal.voterName}</Text>
        <Text style={styles.summary}>
          {signal.debrief_summary || "No summary was generated — check the read below."}
        </Text>
      </View>

      <ChipGroup
        label="Support level"
        options={SUPPORT_LEVELS}
        value={support}
        onChange={setSupport}
      />
      <ChipGroup
        label="Persuadability"
        options={PERSUADABILITY_LEVELS}
        value={persuadability}
        onChange={setPersuadability}
      />
      <ChipGroup
        label="Voter's mood"
        options={EMOTIONAL_VALENCES}
        value={valence}
        onChange={setValence}
      />

      <View>
        <Text style={styles.groupLabel}>TOP ISSUES — tap to remove a wrong one</Text>
        <View style={styles.chipRow}>
          {issues.map((issue) => (
            <TouchableOpacity
              key={issue}
              style={[styles.chip, styles.chipOn]}
              onPress={() => setIssues((prev) => prev.filter((i) => i !== issue))}
            >
              <Text style={styles.chipOnText}>{issue.replace(/_/g, " ")} ✕</Text>
            </TouchableOpacity>
          ))}
          {issues.length === 0 && <Text style={styles.dim}>No issues recorded.</Text>}
        </View>
      </View>

      <View>
        <Text style={styles.groupLabel}>
          WHAT DID YOU LEARN ABOUT THEM? — optional, trumps the voter file
        </Text>
        {OBSERVABLE_ATTRIBUTES.map((attr) => (
          <View key={attr.key} style={{ marginBottom: 10 }}>
            <Text style={styles.attrLabel}>{attr.label}</Text>
            <View style={styles.chipRow}>
              {attr.options.map((option) => {
                const active = observed[attr.key] === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.chip, active && styles.chipOn]}
                    onPress={() =>
                      setObserved((prev) =>
                        active
                          ? Object.fromEntries(
                              Object.entries(prev).filter(([k]) => k !== attr.key),
                            )
                          : { ...prev, [attr.key]: option },
                      )
                    }
                  >
                    <Text style={active ? styles.chipOnText : styles.chipText}>
                      {option.replace(/_/g, " ")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.confirmButton, busy && { opacity: 0.5 }]}
        onPress={() => void handleSubmit()}
        disabled={busy}
      >
        <Text style={styles.confirmText}>
          {corrections.length > 0
            ? `Save ${corrections.length} correction${corrections.length === 1 ? "" : "s"}`
            : "Looks right — confirm"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View>
      <Text style={styles.groupLabel}>{label.toUpperCase()}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, active && styles.chipOn]}
              onPress={() => onChange(opt)}
            >
              <Text style={active ? styles.chipOnText : styles.chipText}>
                {opt.replace(/_/g, " ")}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  voter: { color: colors.text, fontSize: 18, fontWeight: "700" },
  summary: { color: colors.dim, fontSize: 15, lineHeight: 22, marginTop: 8 },
  groupLabel: {
    color: colors.faint,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  attrLabel: { color: colors.dim, fontSize: 13, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // Selected = white on navy (gold is reserved for the single confirm CTA).
  chipOn: { backgroundColor: "#FFFFFF", borderColor: "#FFFFFF" },
  chipText: { color: colors.dim, fontSize: 14 },
  chipOnText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  confirmButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  confirmText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  dim: { color: colors.dim, fontSize: 14 },
  error: { color: colors.red, fontSize: 14 },
});
