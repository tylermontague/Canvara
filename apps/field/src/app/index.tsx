import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Link, Redirect, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { syncDown, syncUp, watchConnectivity } from "@/lib/sync";
import { getActiveShiftId, startShift, endShift } from "@/lib/shift";
import { getCachedWalkLists, queueSizeSync, type CachedWalkList } from "@/lib/local-db";
import { colors } from "@/lib/theme";

export default function Home() {
  const { loading, session, profile } = useSession();
  const [lists, setLists] = useState<CachedWalkList[]>([]);
  const [queueSize, setQueueSize] = useState(0);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLists(getCachedWalkLists());
    setQueueSize(queueSizeSync());
    void getActiveShiftId().then(setShiftId);
  }, []);

  useFocusEffect(reload);

  useEffect(() => {
    const unsubscribe = watchConnectivity((r) => {
      if (r.synced > 0) setNotice(`Synced ${r.synced} pending capture${r.synced === 1 ? "" : "s"}.`);
      reload();
    });
    return unsubscribe;
  }, [reload]);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const up = await syncUp();
      const down = await syncDown(profile);
      setNotice(
        `Synced: ${down.lists} walk list${down.lists === 1 ? "" : "s"}, ${down.stops} doors` +
          (up && up.synced > 0 ? `, ${up.synced} capture${up.synced === 1 ? "" : "s"} uploaded` : "") +
          ".",
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sync failed — will retry when online.");
    } finally {
      setRefreshing(false);
      reload();
    }
  }, [profile, reload]);

  async function toggleShift() {
    if (!profile) return;
    setNotice(null);
    try {
      if (shiftId) {
        await endShift();
        setShiftId(null);
        setNotice("Shift ended.");
      } else {
        const id = await startShift(profile);
        setShiftId(id);
        setNotice("Shift started — good luck out there.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Shift update failed (are you online?).");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>{profile?.full_name ?? session.user.email}</Text>
          <Text style={styles.dim}>
            {shiftId ? "On shift" : "Off shift"}
            {queueSize > 0 ? ` · ${queueSize} capture${queueSize === 1 ? "" : "s"} waiting to sync` : ""}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.shiftButton, shiftId ? styles.shiftEnd : styles.shiftStart]}
          onPress={() => void toggleShift()}
        >
          <Text style={styles.shiftButtonText}>{shiftId ? "End shift" : "Start shift"}</Text>
        </TouchableOpacity>
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      <Link href="/debriefs" asChild>
        <TouchableOpacity style={styles.debriefLink}>
          <Text style={styles.debriefLinkText}>Debriefs</Text>
          <Text style={styles.debriefLinkHint}>Confirm or correct your conversation notes →</Text>
        </TouchableOpacity>
      </Link>

      <Text style={styles.sectionTitle}>Your walk lists</Text>
      <FlatList
        data={lists}
        keyExtractor={(l) => l.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.text} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No walk lists on this device yet. Pull down to sync your assignments.
          </Text>
        }
        renderItem={({ item }) => (
          <Link href={{ pathname: "/walk-list/[id]", params: { id: item.id } }} asChild>
            <TouchableOpacity style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.dim}>
                {item.stop_count} doors · synced {new Date(item.synced_at).toLocaleTimeString()}
              </Text>
            </TouchableOpacity>
          </Link>
        )}
      />

      <TouchableOpacity style={styles.signOut} onPress={() => void supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  hello: { color: colors.text, fontSize: 20, fontWeight: "700" },
  dim: { color: colors.dim, fontSize: 13, marginTop: 2 },
  shiftButton: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  shiftStart: { backgroundColor: colors.green },
  shiftEnd: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  shiftButtonText: { color: colors.text, fontWeight: "600" },
  notice: { color: colors.amber, fontSize: 13, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "600", marginVertical: 8 },
  debriefLink: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  debriefLinkText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  debriefLinkHint: { color: colors.faint, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  empty: { color: colors.faint, fontSize: 14, marginTop: 16, textAlign: "center" },
  signOut: { alignItems: "center", paddingVertical: 12 },
  signOutText: { color: colors.faint, fontSize: 13 },
});
