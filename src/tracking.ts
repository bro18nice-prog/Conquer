import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Crypto from "expo-crypto";
import {
  appendLocations,
  recording,
  transaction,
  write,
  stopRecording,
} from "./storage";
import { Point } from "./core";
const TASK = "conquer-location-v1";
let foreground: Location.LocationSubscription | null = null;
let lastStorageError = "";
const convert = (p: Location.LocationObject): Point => ({
  latitude: p.coords.latitude,
  longitude: p.coords.longitude,
  timestamp: p.timestamp,
  accuracy: p.coords.accuracy ?? 9999,
});
export const trackingError = () => lastStorageError;
async function recordError(message: string) {
  lastStorageError = message;
  try {
    await transaction(async () => {
      const r = await recording();
      if (r) await write("recording", { ...r, error: message });
    });
  } catch {}
}
async function append(points: Point[]) {
  try {
    await appendLocations(points);
  } catch {
    await recordError(
      "Salvarea GPS a eșuat. Verifică spațiul liber și oprește activitatea.",
    );
  }
}
if (Platform.OS !== "web")
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    TASK,
    async ({ data, error }) => {
      if (error) {
        await recordError(error.message);
        return;
      }
      if (data) await append(data.locations.map(convert));
    },
  );
export const nativeBackground =
  Platform.OS !== "web" && Constants.executionEnvironment !== "storeClient";
export async function startTracking(playerId: string) {
  if (await recording())
    throw new Error("Există o activitate nesalvată. Salveaz-o mai întâi.");
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted)
    throw new Error("Permite accesul la locație pentru a înregistra traseul.");
  if (nativeBackground) {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted)
      throw new Error(
        "Pentru ecran stins, permite locația permanentă din setările telefonului.",
      );
  }
  const r = {
    id: Crypto.randomUUID(),
    playerId,
    startedAt: Date.now(),
    points: [] as Point[],
    status: "recording" as const,
    background: nativeBackground,
  };
  lastStorageError = "";
  await write("recording", r);
  try {
    if (nativeBackground)
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        timeInterval: 3000,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Conquer înregistrează",
          notificationBody: "Alergarea continuă cu ecranul stins.",
          killServiceOnDestroy: false,
        },
      });
    else
      foreground = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 5,
          timeInterval: 3000,
        },
        (p) => {
          void append([convert(p)]);
        },
        (message) => {
          void recordError(message);
        },
      );
  } catch (e) {
    await stopRecording();
    throw e;
  }
  return r;
}
export async function stopTracking() {
  foreground?.remove();
  foreground = null;
  // Stop accepting points first, including callbacks arriving during the OS stop request.
  const r = await stopRecording();
  if (nativeBackground && (await Location.hasStartedLocationUpdatesAsync(TASK)))
    await Location.stopLocationUpdatesAsync(TASK);
  return r;
}
export async function recoverTracking() {
  const r = await recording();
  if (!r) return null;
  if (r.status === "stopped") {
    if (
      nativeBackground &&
      (await Location.hasStartedLocationUpdatesAsync(TASK))
    )
      await Location.stopLocationUpdatesAsync(TASK);
    return r;
  }
  const running = nativeBackground
    ? await Location.hasStartedLocationUpdatesAsync(TASK)
    : !!foreground;
  if (!running) {
    await transaction(async () => {
      const current = await recording();
      if (current)
        await write("recording", {
          ...current,
          status: "stopped",
          error:
            "Activitate recuperată după întrerupere. Salvează traseul înainte de o nouă alergare.",
        });
    });
  }
  return recording();
}
export async function locate() {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) throw new Error("Accesul la locație nu a fost permis.");
  return convert(
    await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }),
  );
}
