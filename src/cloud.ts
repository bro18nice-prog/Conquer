import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Run, Player, Territory } from "./core";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const cloud =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;
export type Snapshot = {
  group: { id: string; name: string; invite: string };
  players: Player[];
  territories: Territory[];
};
export type Receipt = {
  area: number;
  distance: number;
  reason: string;
  duplicate: boolean;
};
export async function snapshot(): Promise<Snapshot | null> {
  if (!cloud) return null;
  const { data, error } = await cloud.rpc("conquer_snapshot");
  if (error) throw error;
  return data;
}
export async function upload(run: Run): Promise<Receipt> {
  if (!cloud) throw new Error("Serverul grupului nu este configurat.");
  const { data, error } = await cloud.rpc("conquer_submit", {
    run_id: run.id,
    points: run.points,
  });
  if (error) throw error;
  return data;
}
