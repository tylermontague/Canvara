import { config } from "dotenv";
import path from "node:path";
import type { ExpoConfig } from "expo/config";

// Credentials live in the repo-root .env (single source of truth, never
// committed). Exposed to the app via expoConfig.extra — anon key only;
// the service_role key must never reach a device.
config({ path: path.resolve(__dirname, "../../.env") });

const expoConfig: ExpoConfig = {
  name: "Canvara Field",
  slug: "canvara-field",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "canvara-field",
  userInterfaceStyle: "dark",
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0b0b0d",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission:
          "Canvara records door conversations (with disclosure) to generate campaign insights.",
      },
    ],
    "expo-sqlite",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Canvara uses your location to match conversations to the right door.",
      },
    ],
  ],
  experiments: {
    // typedRoutes generates route types at dev-server start by resolving
    // expo-router from the repo root, where npm nested it under the app
    // instead of hoisting — which crashes `expo start`. Off until the
    // dependency is hoisted (a deploy-time / EAS concern). Routing itself
    // is unaffected; this only drops route-name TypeScript autocomplete.
    typedRoutes: false,
    reactCompiler: true,
  },
  extra: {
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  },
};

export default expoConfig;
