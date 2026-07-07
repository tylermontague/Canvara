import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "@/lib/session";
import { colors } from "@/lib/theme";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Canvara Field" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
        <Stack.Screen name="walk-list/[id]" options={{ title: "Walk list" }} />
        <Stack.Screen name="stop/[itemId]" options={{ title: "Door" }} />
        <Stack.Screen name="debriefs" options={{ title: "Debriefs" }} />
        <Stack.Screen name="debrief/[signalId]" options={{ title: "Debrief" }} />
      </Stack>
    </SessionProvider>
  );
}
