// Shift join/end (FA-1). Starting a shift needs connectivity (it writes the
// shifts row); the active shift id is kept locally so offline captures can
// still attach to it. Ending while offline just clears locally — the row's
// ended_at stays open until a future milestone adds queued shift updates.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
import type { Profile } from "./session";

const KEY = "canvara.activeShiftId";

export async function getActiveShiftId(): Promise<string | null> {
  return await AsyncStorage.getItem(KEY);
}

export async function startShift(profile: Profile): Promise<string> {
  const id = Crypto.randomUUID();
  const { error } = await supabase.from("shifts").insert({
    id,
    campaign_id: profile.campaign_id,
    canvasser_id: profile.id,
  });
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem(KEY, id);
  return id;
}

export async function endShift(): Promise<void> {
  const id = await AsyncStorage.getItem(KEY);
  await AsyncStorage.removeItem(KEY);
  if (!id) return;
  await supabase
    .from("shifts")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id);
}
