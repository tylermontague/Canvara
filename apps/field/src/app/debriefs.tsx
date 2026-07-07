// Pending debriefs (FA-5): conversations whose signals await the
// canvasser's confirm/correct. Needs connectivity — signals are produced
// by the pipeline, so there is nothing to confirm while offline.

import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Link, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

export interface PendingDebrief {
  signalId: string;
  conversationId: string;
  recordedAt: string;
  voterName: string;
  summary: string;
  supportLevel: string | null;
}

export function usePendingDebriefs() {
  const { profile } = useSession();
  const [items, setItems] = useState<PendingDebrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from("signals")
      .select(
        "id, debrief_summary, support_level, canvasser_confirmed, conversations!inner(id, canvasser_id, recorded_at, status, voters(first_name, last_name))",
      )
      .eq("canvasser_confirmed", false)
      .eq("conversations.canvasser_id", profile.id)
      .in("conversations.status", ["extracted", "review"])
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setItems(
      (data ?? []).map((s) => ({
        signalId: s.id,
        conversationId: s.conversations.id,
        recordedAt: s.conversations.recorded_at,
        voterName: s.conversations.voters
          ? `${s.conversations.voters.first_name ?? ""} ${s.conversations.voters.last_name ?? ""}`.trim()
          : "Unmatched door",
        summary: s.debrief_summary ?? "",
        supportLevel: s.support_level,
      })),
    );
  }, [profile]);

  return { items, error, load };
}

export default function DebriefsScreen() {
  const { items, error, load } = usePendingDebriefs();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (items === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error} — are you online?</Text>}
      <FlatList
        data={items ?? []}
        keyExtractor={(d) => d.signalId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.text}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nothing to debrief — new conversations appear here a minute or two
            after each door.
          </Text>
        }
        renderItem={({ item }) => (
          <Link
            href={{ pathname: "/debrief/[signalId]", params: { signalId: item.signalId } }}
            asChild
          >
            <TouchableOpacity style={styles.card}>
              <Text style={styles.voter}>{item.voterName}</Text>
              <Text style={styles.summary} numberOfLines={2}>
                {item.summary || "No summary — open to review the read."}
              </Text>
              <Text style={styles.meta}>
                {new Date(item.recordedAt).toLocaleTimeString()} ·{" "}
                {(item.supportLevel ?? "unknown").replace("_", " ")}
              </Text>
            </TouchableOpacity>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  error: { color: colors.red, fontSize: 14, marginBottom: 10 },
  empty: { color: colors.faint, fontSize: 14, marginTop: 24, textAlign: "center" },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  voter: { color: colors.text, fontSize: 16, fontWeight: "600" },
  summary: { color: colors.dim, fontSize: 14, marginTop: 4, lineHeight: 20 },
  meta: { color: colors.faint, fontSize: 12, marginTop: 8 },
});
