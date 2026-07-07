import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import type { Database } from "@canvara/db";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

if (!extra.supabaseUrl || !extra.supabaseAnonKey) {
  throw new Error(
    "Supabase credentials missing — fill in the repo-root .env and restart `expo start`.",
  );
}

export const supabase = createClient<Database>(extra.supabaseUrl, extra.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
