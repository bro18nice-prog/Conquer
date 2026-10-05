import {
  ExerciseSet,
  addExerciseSet,
  reviseExerciseSet,
  setExerciseGoal,
  Progression,
  ExerciseId,
  localDay,
  updateMission,
  validateProgression,
  mergeProgression,
} from "./progression";
import {
  Point,
  Run,
  analyze,
  distance,
  validPoint,
  territoriesFromRuns,
  recalculateRuns,
} from "./core";
export type Recording = {
  id: string;
  playerId: string;
  startedAt: number;
  points: Point[];
  status: "recording" | "stopped";
  background: boolean;
  error?: string;
};
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export function createRepository(store: KeyValueStore) {
  let queue: Promise<unknown> = Promise.resolve();
  function transaction<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }
  async function read<T>(key: string, fallback: T): Promise<T> {
    const s = await store.getItem("conquer:" + key);
    return s ? JSON.parse(s) : fallback;
  }
  async function write(key: string, value: unknown) {
    await store.setItem("conquer:" + key, JSON.stringify(value));
  }
  const recording = () => read<Recording | null>("recording", null);
  const getRuns = (demo: boolean) =>
    read<Run[]>(demo ? "demo-runs" : "runs", []);
  const upgradeRuns = () =>
    transaction(async () => {
      const runs = await getRuns(false);
      if (runs.every((r) => r.synced || r.captureVersion === 2)) return runs;
      const updated = recalculateRuns(runs);
      await write("runs-before-v2", runs);
      await write("runs", updated);
      return updated;
    });
  // Drop noisy fixes at capture time: poor accuracy, or a jump that is
  // physically impossible for a runner (cell/Wi-Fi fixes, tunnels, cold start).
  const plausible = (prev: Point | undefined, p: Point) => {
    if (!validPoint(p) || p.accuracy > 25) return false;
    if (!prev) return true;
    const dt = (p.timestamp - prev.timestamp) / 1000;
    const d = distance(prev, p);
    if (d < Math.max(2, Math.min(prev.accuracy, p.accuracy) * 0.5)) return false;
    return dt > 0 && d / dt <= 8;
  };
  const appendLocations = (points: Point[]) =>
    transaction(async () => {
      const r = await recording();
      if (!r || r.status === "stopped") return;
      let last = r.points.at(-1)?.timestamp ?? 0;
      for (const p of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
        if (r.points.length >= 10000) {
          r.error =
            "Limita de 10.000 de puncte GPS a fost atinsă. Oprește și salvează activitatea.";
          break;
        }
        if (p.timestamp > last && plausible(r.points.at(-1), p)) {
          r.points.push(p);
          last = p.timestamp;
        }
      }
      await write("recording", r);
    });
  const saveRun = (run: Run, demo: boolean) =>
    transaction(async () => {
      const runs = await getRuns(demo);
      if (!runs.some((r) => r.id === run.id)) runs.push(run);
      await write(demo ? "demo-runs" : "runs", runs);
      return runs;
    });
  const stopRecording = () =>
    transaction(async () => {
      const r = await recording();
      if (r) {
        r.status = "stopped";
        await write("recording", r);
      }
      return r;
    });
  const finalize = () =>
    transaction(async () => {
      const r = await recording();
      if (!r) return null;
      if (r.status !== "stopped")
        throw new Error("Oprește înregistrarea înainte de salvare.");
      const runs = await getRuns(false);
      let run = runs.find((x) => x.id === r.id);
      if (!run) {
        run = {
          id: r.id,
          playerId: r.playerId || "me",
          startedAt: r.startedAt,
          finishedAt: r.points.at(-1)?.timestamp || Date.now(),
          points: r.points,
          ...analyze(
            r.points,
            territoriesFromRuns(runs).find(
              (t) => t.playerId === (r.playerId || "me"),
            )?.polygon || [],
          ),
          captureVersion: 2,
        };
        runs.push(run);
        await write("runs", runs);
      }
      // Clear only after the run is durable. Retrying after failure cannot duplicate it.
      await write("recording", null);
      return { run, runs };
    });

  const getProgression = async () => {
    const current = await read<Progression | null>("progression", null);
    return current
      ? validateProgression(current)
      : { startedDay: localDay(), missions: [] };
  };
  const ensureProgression = () =>
    transaction(async () => {
      const p = await getProgression();
      await write("progression", p);
      return p;
    });
  const changeMission = (day: string, id: ExerciseId, target?: number) =>
    transaction(async () => {
      if (day !== localDay())
        throw new Error("Ziua s-a schimbat. Reîncarcă misiunile.");
      const p = updateMission(await getProgression(), day, id, target);
      await write("progression", p);
      return p;
    });

  const recordExercise = (set: ExerciseSet) =>
    transaction(async () => {
      if (set.day !== localDay()) throw Error("Ziua s-a schimbat. Reîncearcă.");
      const p = addExerciseSet(await getProgression(), set);
      await write("progression", p);
      return p;
    });
  const reviseExercise = (id: string, amount: number | null) =>
    transaction(async () => {
      const p = reviseExerciseSet(await getProgression(), id, amount);
      await write("progression", p);
      return p;
    });
  const changeGoal = (id: ExerciseId, target: number) =>
    transaction(async () => {
      const p = setExerciseGoal(await getProgression(), id, target);
      await write("progression", p);
      return p;
    });
  const exportProgress = () =>
    transaction(async () =>
      JSON.stringify(
        {
          format: "conquer-backup",
          version: 3,
          exportedAt: new Date().toISOString(),
          runs: await getRuns(false),
          progression: await getProgression(),
        },
        null,
        2,
      ),
    );
  const importProgress = (text: string) =>
    transaction(async () => {
      if (await recording())
        throw new Error("Salvează activitatea în curs înainte de import.");
      if (text.length > 25000000) throw new Error("Copia este prea mare.");
      const parsed = JSON.parse(text);
      if (
        parsed.format !== "conquer-backup" ||
        ![1, 2, 3].includes(parsed.version) ||
        !Array.isArray(parsed.runs) ||
        parsed.runs.length > 1000
      )
        throw new Error("Fișier de progres Conquer nevalid.");
      const incomingProgression =
        parsed.version >= 2 ? validateProgression(parsed.progression) : null;
      const current = await getRuns(false),
        merged = [...current];
      let count = 0;
      for (const r of parsed.runs) {
        if (
          !r ||
          typeof r.id !== "string" ||
          !r.id ||
          r.id.length > 100 ||
          typeof r.playerId !== "string" ||
          !Number.isFinite(r.startedAt) ||
          !Number.isFinite(r.finishedAt) ||
          r.finishedAt < r.startedAt ||
          !Array.isArray(r.points) ||
          r.points.length > 10000 ||
          r.points.some(
            (p: Point) =>
              !p ||
              ![p.latitude, p.longitude, p.timestamp, p.accuracy].every(
                Number.isFinite,
              ) ||
              Math.abs(p.latitude) > 90 ||
              Math.abs(p.longitude) > 180 ||
              p.accuracy < 0,
          )
        )
          throw new Error("Activitate nevalidă în copia de progres.");
        const existing = merged.find((x) => x.id === r.id);
        if (existing) {
          if (
            JSON.stringify(existing.points) !== JSON.stringify(r.points) ||
            existing.playerId !== r.playerId
          )
            throw new Error(
              "Copia conține o activitate cu același ID și alte date.",
            );
          continue;
        }
        if (r.playerId !== "me")
          throw new Error(
            "Această copie aparține unui cont online. Importul pilot acceptă activitățile locale.",
          );
        merged.push({
          id: r.id,
          playerId: "me",
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          points: r.points,
          distance: 0,
          area: 0,
          polygon: [],
          reason: "",
        });
        count++;
      }
      const runs = recalculateRuns(merged);
      await write("runs-before-import", current);
      await write("runs", runs);
      const progression = incomingProgression
        ? mergeProgression(await getProgression(), incomingProgression)
        : await getProgression();
      await write("progression", progression);
      return { runs, count, progression };
    });

  return {
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
  };
}
