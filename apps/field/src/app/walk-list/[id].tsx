import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Link, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { getCachedStops, type CachedStop } from "@/lib/local-db";
import { supabase } from "@/lib/supabase";
import { StopsMap, type MapPin } from "@/components/stops-map";
import { colors } from "@/lib/theme";

const STATUS_COLORS: Record<string, string> = {
  pending: colors.dim,
  visited: colors.green,
  not_home: colors.amber,
  skipped: colors.faint,
  rescheduled: colors.amber,
};

export default function WalkListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [stops, setStops] = useState<CachedStop[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [pins, setPins] = useState<MapPin[]>([]);

  const reload = useCallback(() => {
    setStops(getCachedStops(id));
  }, [id]);

  useFocusEffect(reload);

  // Coordinates come from the voter_coords view (only voters with geocoded
  // locations). Fetched online, best-effort — the list view is the fallback.
  useEffect(() => {
    const voterIds = stops.map((s) => s.voter_id).filter((v): v is string => v !== null);
    if (voterIds.length === 0 || !showMap) return;
    void supabase
      .from("voter_coords")
      .select("voter_id, lat, lng")
      .in("voter_id", voterIds)
      .then(({ data }) => {
        if (!data) return;
        const byVoter = new Map(data.map((c) => [c.voter_id, c]));
        setPins(
          stops.flatMap((s) => {
            const c = s.voter_id ? byVoter.get(s.voter_id) : undefined;
            return c
              ? [{ lat: c.lat, lng: c.lng, label: String(s.position), visited: s.status === "visited" }]
              : [];
          }),
        );
      });
  }, [stops, showMap]);

  const done = stops.filter((s) => s.status !== "pending").length;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Walk list",
          headerRight: () => (
            <TouchableOpacity onPress={() => setShowMap((m) => !m)}>
              <Text style={styles.toggle}>{showMap ? "List" : "Map"}</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Text style={styles.progress}>
        {done} of {stops.length} doors done
      </Text>

      {showMap ? (
        <StopsMap pins={pins} />
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(s) => s.item_id}
          renderItem={({ item }) => (
            <Link href={{ pathname: "/stop/[itemId]", params: { itemId: item.item_id } }} asChild>
              <TouchableOpacity style={styles.stop}>
                <Text style={styles.position}>{item.position}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {item.voter.last_name}, {item.voter.first_name}
                  </Text>
                  <Text style={styles.address}>
                    {item.voter.address}, {item.voter.city}
                  </Text>
                </View>
                <Text style={[styles.status, { color: STATUS_COLORS[item.status] ?? colors.dim }]}>
                  {item.status.replace("_", " ")}
                </Text>
              </TouchableOpacity>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  toggle: { color: colors.text, fontSize: 15, fontWeight: "600", padding: 4 },
  progress: { color: colors.dim, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  position: { color: colors.faint, fontSize: 14, width: 28, textAlign: "right" },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  address: { color: colors.dim, fontSize: 13, marginTop: 2 },
  status: { fontSize: 12, fontWeight: "600" },
});
