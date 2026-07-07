import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { QueuedCapture } from "@canvara/shared";
import { useSession } from "@/lib/session";
import {
  getCachedStop,
  getCachedSurveyQuestions,
  setCachedStopStatus,
  sqliteQueueStore,
} from "@/lib/local-db";
import { getActiveShiftId } from "@/lib/shift";
import { syncUp } from "@/lib/sync";
import { colors } from "@/lib/theme";

// ADR-6: universal disclosure, one workflow everywhere. Tapping "start"
// is the canvasser's confirmation that the disclosure was made; the
// timestamp is logged on the conversation.
const DISCLOSURE = "“Just so you know, I use automated notes so I can focus on our conversation.”";

const CONTACT_RESULTS = [
  { key: "full_conversation", label: "Full conversation" },
  { key: "brief_exchange", label: "Brief exchange" },
  { key: "answered", label: "Answered only" },
  { key: "refused", label: "Refused" },
] as const;

type Phase = "briefing" | "recording" | "result" | "poll";

export default function StopScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { profile } = useSession();
  const stop = useMemo(() => getCachedStop(itemId), [itemId]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const consentAtRef = useRef<string | null>(null);
  const recordedAtRef = useRef<string | null>(null);
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Door poll (M6.5): cached questions, answers keyed by question id.
  const questions = useMemo(() => getCachedSurveyQuestions(), []);
  const contactResultRef = useRef<string | null>(null);
  const [pollAnswers, setPollAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  if (!stop || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>This door isn&apos;t on your device. Sync from the home screen.</Text>
      </View>
    );
  }

  const v = stop.voter;
  const age = v.birth_year ? new Date().getFullYear() - v.birth_year : null;
  const voteCount = v.vote_history ? Object.values(v.vote_history).filter(Boolean).length : 0;

  async function grabGps() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      gpsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // GPS is best-effort; correlation falls back to the walk-list stop.
    }
  }

  async function startRecording() {
    setError(null);
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) {
      setError("Microphone permission is required to capture conversations.");
      return;
    }
    consentAtRef.current = new Date().toISOString();
    recordedAtRef.current = consentAtRef.current;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setSeconds(0);
    setPhase("recording");
    void grabGps(); // in parallel with the conversation
  }

  async function stopRecording() {
    await recorder.stop();
    setPhase("result");
  }

  /** Result tap → poll step when the campaign has questions, else save. */
  function handleContactResult(contactResult: string) {
    contactResultRef.current = contactResult;
    if (questions.length > 0) {
      setPhase("poll");
    } else {
      void saveCapture(contactResult);
    }
  }

  async function saveCapture(contactResult: string) {
    setError(null);
    try {
      // Persist the recording outside the cache dir so the OS can't evict
      // it while it waits in the queue.
      let audioUri: string | null = null;
      if (recorder.uri) {
        const dir = new Directory(Paths.document, "captures");
        try {
          dir.create({ intermediates: true });
        } catch {
          // already exists
        }
        const file = new File(recorder.uri);
        const dest = new File(dir, `${Crypto.randomUUID()}.m4a`);
        file.move(dest);
        audioUri = dest.uri;
      }

      const capture: QueuedCapture = {
        id: Crypto.randomUUID(),
        kind: "conversation",
        campaignId: profile!.campaign_id,
        canvasserId: profile!.id,
        shiftId: await getActiveShiftId(),
        voterId: stop!.voter_id,
        walkListItemId: stop!.item_id,
        audioUri,
        recordedAt: recordedAtRef.current ?? new Date().toISOString(),
        gpsLat: gpsRef.current?.lat ?? null,
        gpsLng: gpsRef.current?.lng ?? null,
        consentDisclosedAt: consentAtRef.current,
        contactResult,
        stopStatus: "visited",
        surveyResponses: Object.entries(pollAnswers).map(([questionId, answer]) => ({
          questionId,
          answer,
        })),
        attempts: 0,
        lastError: null,
      };
      await sqliteQueueStore.add(capture);
      setCachedStopStatus(stop!.item_id, "visited");
      void syncUp(); // best-effort; reconnect watcher covers the offline case
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save capture.");
    }
  }

  async function quickOutcome(status: "not_home" | "skipped") {
    await grabGps();
    const capture: QueuedCapture = {
      id: Crypto.randomUUID(),
      kind: "status_only",
      campaignId: profile!.campaign_id,
      canvasserId: profile!.id,
      shiftId: await getActiveShiftId(),
      voterId: stop!.voter_id,
      walkListItemId: stop!.item_id,
      audioUri: null,
      recordedAt: new Date().toISOString(),
      gpsLat: gpsRef.current?.lat ?? null,
      gpsLng: gpsRef.current?.lng ?? null,
      consentDisclosedAt: null,
      contactResult: null,
      stopStatus: status,
      attempts: 0,
      lastError: null,
    };
    await sqliteQueueStore.add(capture);
    setCachedStopStatus(stop!.item_id, status);
    void syncUp();
    router.back();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Tier-1 briefing (FA-3): identity from the local store, instant. */}
      <View style={styles.card}>
        <Text style={styles.name}>
          {v.first_name} {v.last_name}
        </Text>
        <Text style={styles.address}>
          {v.address}, {v.city} {v.zip}
        </Text>
        <View style={styles.factsRow}>
          {age !== null && <Fact label="Age" value={String(age)} />}
          {v.party && <Fact label="Party" value={v.party} />}
          {v.gender && <Fact label="Gender" value={v.gender} />}
          {v.precinct && <Fact label="Precinct" value={v.precinct} />}
          <Fact label="Vote history" value={voteCount > 0 ? `${voteCount} elections` : "none on file"} />
        </View>
        {(v.beliefs?.length ?? 0) > 0 && (
          <View style={styles.beliefs}>
            <Text style={styles.beliefsLabel}>LIKELY CARES ABOUT</Text>
            <View style={styles.beliefsRow}>
              {v.beliefs!.map((b) => (
                <View key={b.issue} style={styles.beliefChip}>
                  <Text style={styles.beliefText}>
                    {b.issue.replace(/_/g, " ")} · {Math.round(b.mean * 100)}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {(v.connection?.length ?? 0) > 0 && (
          <View style={styles.beliefs}>
            <Text style={styles.beliefsLabel}>CONNECTION NOTES</Text>
            {v.connection!.map((fact) => (
              <Text key={fact} style={styles.connectionFact}>
                · {fact}
              </Text>
            ))}
          </View>
        )}
        {(v.attributes?.length ?? 0) > 0 && (
          <View style={styles.beliefs}>
            <Text style={styles.beliefsLabel}>OBSERVED AT THE DOOR</Text>
            <View style={styles.beliefsRow}>
              {v.attributes!.map((a) => (
                <View key={a.key} style={styles.beliefChip}>
                  <Text style={styles.beliefText}>
                    {a.key.replace(/_/g, " ")}: {a.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {phase === "briefing" && (
        <>
          <View style={styles.card}>
            <Text style={styles.disclosureLabel}>Disclosure — say this at the door:</Text>
            <Text style={styles.disclosure}>{DISCLOSURE}</Text>
          </View>
          <TouchableOpacity style={styles.recordButton} onPress={() => void startRecording()}>
            <Text style={styles.recordButtonText}>Disclosed — start conversation</Text>
          </TouchableOpacity>
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickButton} onPress={() => void quickOutcome("not_home")}>
              <Text style={styles.quickText}>Not home</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickButton} onPress={() => void quickOutcome("skipped")}>
              <Text style={styles.quickText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {phase === "recording" && (
        <View style={styles.recordingWrap}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingTime}>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </Text>
          <Text style={styles.dim}>Recording — focus on the conversation.</Text>
          <TouchableOpacity style={styles.stopButton} onPress={() => void stopRecording()}>
            <Text style={styles.stopButtonText}>End conversation</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === "result" && (
        <View style={{ gap: 8 }}>
          <Text style={styles.sectionTitle}>How did it go?</Text>
          {CONTACT_RESULTS.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={styles.resultButton}
              onPress={() => handleContactResult(r.key)}
            >
              <Text style={styles.resultText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {phase === "poll" && (
        <View style={{ gap: 16 }}>
          <Text style={styles.sectionTitle}>Quick poll (optional)</Text>
          {questions.map((q) => (
            <View key={q.id}>
              <Text style={styles.pollQuestion}>{q.question}</Text>
              <View style={styles.chipRow}>
                {q.options.map((option) => {
                  const active = pollAnswers[q.id] === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, active && styles.chipOn]}
                      onPress={() =>
                        setPollAnswers((prev) =>
                          active
                            ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== q.id))
                            : { ...prev, [q.id]: option },
                        )
                      }
                    >
                      <Text style={active ? styles.chipOnText : styles.chipText}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={() => void saveCapture(contactResultRef.current ?? "answered")}
          >
            <Text style={styles.confirmText}>
              {Object.keys(pollAnswers).length > 0
                ? `Save with ${Object.keys(pollAnswers).length} answer${Object.keys(pollAnswers).length === 1 ? "" : "s"}`
                : "Skip poll & save"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  name: { color: colors.text, fontSize: 22, fontWeight: "700" },
  address: { color: colors.dim, fontSize: 14, marginTop: 2 },
  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
  fact: {},
  factLabel: { color: colors.faint, fontSize: 11, textTransform: "uppercase" },
  factValue: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 1 },
  beliefs: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  beliefsLabel: { color: colors.faint, fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
  beliefsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  beliefChip: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  beliefText: { color: colors.dim, fontSize: 13 },
  connectionFact: { color: colors.dim, fontSize: 14, lineHeight: 21 },
  pollQuestion: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
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
  disclosureLabel: { color: colors.faint, fontSize: 12, textTransform: "uppercase", marginBottom: 6 },
  disclosure: { color: colors.text, fontSize: 16, lineHeight: 22, fontStyle: "italic" },
  recordButton: {
    backgroundColor: colors.recording,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  recordButtonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  quickRow: { flexDirection: "row", gap: 10 },
  quickButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  quickText: { color: colors.dim, fontSize: 15, fontWeight: "600" },
  recordingWrap: { alignItems: "center", gap: 10, paddingVertical: 24 },
  recordingDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.recording },
  recordingTime: { color: colors.text, fontSize: 40, fontVariant: ["tabular-nums"], fontWeight: "700" },
  stopButton: {
    backgroundColor: colors.card,
    borderColor: colors.recording,
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 10,
  },
  stopButtonText: { color: colors.recording, fontSize: 16, fontWeight: "700" },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  resultButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  resultText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  dim: { color: colors.dim, fontSize: 14, textAlign: "center" },
  error: { color: colors.red, fontSize: 14 },
});
