import AsyncStorage from "@react-native-async-storage/async-storage";
import { createRepository } from "./repository";
export type { Recording } from "./repository";
export const {
  recordExercise,
  reviseExercise,
  changeGoal,
  ensureProgression,
  changeMission,
  getProgression,
  upgradeRuns,
  exportProgress,
  importProgress,
  transaction,
  read,
  write,
  recording,
  getRuns,
  appendLocations,
  saveRun,
  stopRecording,
  finalize,
} = createRepository(AsyncStorage);
