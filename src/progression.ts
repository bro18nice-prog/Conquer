import { Run, validPoint, distance, length } from "./core";
export const EXERCISES = [
  { id: "pushups", name: "Flotări", base: 5, cap: 20, xp: 25 },
  { id: "squats", name: "Genuflexiuni", base: 10, cap: 30, xp: 30 },
  { id: "crunches", name: "Abdomene", base: 5, cap: 20, xp: 25 },
] as const;
export type ExerciseId = (typeof EXERCISES)[number]["id"];
export type WorkoutId = ExerciseId | "plank";
export const WORKOUTS = [
  { id: "pushups", name: "Flotări", rate: 3, unit: "repetări" },
  { id: "squats", name: "Genuflexiuni", rate: 2, unit: "repetări" },
  { id: "crunches", name: "Abdomene", rate: 2, unit: "repetări" },
  { id: "plank", name: "Plank", rate: 0.2, unit: "secunde" },
] as const;
export type ExerciseSet = {
  id: string;
  day: string;
  exercise: WorkoutId;
  amount: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};
export type Mission = {
  day: string;
  exercise: ExerciseId;
  target: number;
  completed: boolean;
};
export type Progression = {
  startedDay: string;
  missions: Mission[];
  sets?: ExerciseSet[];
  goals?: Partial<Record<ExerciseId, number>>;
};
export const localDay = (date = new Date()) =>
  date.getFullYear() +
  "-" +
  String(date.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(date.getDate()).padStart(2, "0");
const ordinal = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export const dayNumber = (p: Progression, day: string) =>
  Math.max(1, Math.floor(ordinal(day) - ordinal(p.startedDay)) + 1);
export function missionsForDay(p: Progression, day: string): Mission[] {
  return EXERCISES.map(
    (e) =>
      p.missions.find((m) => m.day === day && m.exercise === e.id) || {
        day,
        exercise: e.id,
        target: p.goals?.[e.id] ?? e.base,
        completed: false,
      },
  );
}
export function updateMission(
  p: Progression,
  day: string,
  id: ExerciseId,
  target?: number,
): Progression {
  const current = missionsForDay(p, day).find((m) => m.exercise === id);
  if (!current) throw new Error("Misiune necunoscută.");
  if (current.completed) return p;
  if (
    target !== undefined &&
    (!Number.isInteger(target) || target < 1 || target > 100)
  )
    throw new Error("Alege între 1 și 100 de repetări.");
  const next =
    target === undefined
      ? { ...current, completed: true }
      : { ...current, target };
  return {
    ...p,
    missions: [
      ...p.missions.filter((m) => m.day !== day || m.exercise !== id),
      next,
    ],
  };
}
function legacyXP(p: Progression) {
  const unique = new Map(p.missions.map((m) => [m.day + ":" + m.exercise, m]));
  let xp = 0;
  const days = new Map<string, Set<string>>();
  for (const m of unique.values()) {
    if (!m.completed) continue;
    xp += EXERCISES.find((e) => e.id === m.exercise)!.xp;
    if (!days.has(m.day)) days.set(m.day, new Set());
    days.get(m.day)!.add(m.exercise);
  }
  return xp + [...days.values()].filter((s) => s.size === 3).length * 20;
}
export function runXP(r: Run) {
  const pts = r.points.filter(validPoint);
  if (pts.length < 2 || length(pts) < 200) return 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].timestamp - pts[i - 1].timestamp) / 1000;
    if (dt <= 0 || dt > 120 || distance(pts[i - 1], pts[i]) / dt > 8) return 0;
  }
  return (
    Math.min(100, Math.floor(length(pts) / 100)) +
    Math.min(200, Math.floor(Math.max(0, r.area) / 500))
  );
}
export function totalXP(p: Progression, runs: Run[], owner = "me") {
  return (
    exerciseXP(p) +
    [
      ...new Map(
        runs
          .filter((r) => r.playerId === owner && !r.id.startsWith("seed-"))
          .map((r) => [r.id, r]),
      ).values(),
    ].reduce((sum, r) => sum + runXP(r), 0)
  );
}
export function levelInfo(total: number) {
  let level = 1,
    xp = Math.max(0, Math.floor(total)),
    required = 100;
  while (xp >= required) {
    xp -= required;
    level++;
    required += 50;
  }
  return { level, xp, required, total, ratio: xp / required };
}
export function validateProgression(value: unknown): Progression {
  const p = value as Progression;
  const validDay = (s: unknown) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (
    !p ||
    !validDay(p.startedDay) ||
    !Array.isArray(p.missions) ||
    p.missions.length > 30000
  )
    throw new Error("Progres XP nevalid.");
  const ids = new Set<string>();
  for (const m of p.missions) {
    const key = m?.day + ":" + m?.exercise;
    if (
      !m ||
      !validDay(m.day) ||
      m.day < p.startedDay ||
      !EXERCISES.some((e) => e.id === m.exercise) ||
      !Number.isInteger(m.target) ||
      m.target < 1 ||
      m.target > 100 ||
      typeof m.completed !== "boolean" ||
      ids.has(key)
    )
      throw new Error("Misiune nevalidă în copia de progres.");
    ids.add(key);
  }
  validateSets(p);
  return {
    startedDay: p.startedDay,
    missions: p.missions.map((m) => ({ ...m })),
    sets: (p.sets || []).map((s) => ({ ...s })),
    goals: { ...p.goals },
  };
}
export function mergeProgression(a: Progression, b: Progression): Progression {
  const items = new Map(a.missions.map((m) => [m.day + ":" + m.exercise, m]));
  for (const m of b.missions) {
    const k = m.day + ":" + m.exercise,
      current = items.get(k);
    if (!current || (!current.completed && m.completed)) items.set(k, m);
  }
  return {
    startedDay: a.startedDay < b.startedDay ? a.startedDay : b.startedDay,
    missions: [...items.values()],
    sets: mergeSets(a.sets || [], b.sets || []),
    goals: { ...b.goals, ...a.goals },
  };
}

const validDate = (s: unknown) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function validateSets(p: Progression) {
  if (
    p.goals !== undefined &&
    (!p.goals ||
      typeof p.goals !== "object" ||
      Array.isArray(p.goals) ||
      Object.entries(p.goals).some(
        ([id, n]) =>
          !EXERCISES.some((e) => e.id === id) ||
          !Number.isInteger(n) ||
          n! < 1 ||
          n! > 100,
      ))
  )
    throw Error("Obiective nevalide.");
  if (
    p.sets !== undefined &&
    (!Array.isArray(p.sets) || p.sets.length > 100000)
  )
    throw Error("Jurnal nevalid.");
  const ids = new Set<string>();
  for (const s of p.sets || []) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      s.id.length > 100 ||
      ids.has(s.id) ||
      !validDate(s.day) ||
      s.day < p.startedDay ||
      !WORKOUTS.some((e) => e.id === s.exercise) ||
      !Number.isInteger(s.amount) ||
      s.amount < 1 ||
      s.amount > (s.exercise === "plank" ? 3600 : 1000) ||
      !Number.isFinite(s.createdAt) ||
      s.createdAt < 0 ||
      !Number.isFinite(s.updatedAt) ||
      s.updatedAt < s.createdAt ||
      typeof s.deleted !== "boolean"
    )
      throw Error("Set nevalid în jurnal.");
    ids.add(s.id);
  }
}
export const activeSets = (p: Progression) =>
  (p.sets || []).filter((s) => !s.deleted);
export const dayAmount = (p: Progression, day: string, id: WorkoutId) =>
  activeSets(p)
    .filter((s) => s.day === day && s.exercise === id)
    .reduce((n, s) => n + s.amount, 0);
export const amountXP = (id: WorkoutId, amount: number) =>
  Math.floor(amount * (WORKOUTS.find((e) => e.id === id)?.rate || 0));
export function dailyMissions(p: Progression, day: string) {
  return missionsForDay(p, day).map((m) => ({
    ...m,
    amount: dayAmount(p, day, m.exercise),
    completed: dayAmount(p, day, m.exercise) >= m.target,
  }));
}
export function exerciseXP(p: Progression) {
  const sets = activeSets(p),
    days = [...new Set(sets.map((s) => s.day))];
  const reps = sets
    .filter((s) => s.exercise !== "plank")
    .reduce((n, s) => n + amountXP(s.exercise, s.amount), 0);
  const plank = days.reduce(
    (n, d) => n + amountXP("plank", dayAmount(p, d, "plank")),
    0,
  );
  const bonus =
    days.filter(
      (d) =>
        missionsForDay(p, d).every(
          (m) => dayAmount(p, d, m.exercise) >= m.target,
        ) &&
        !EXERCISES.every((e) =>
          p.missions.some(
            (m) => m.day === d && m.exercise === e.id && m.completed,
          ),
        ),
    ).length * 20;
  return legacyXP(p) + reps + plank + bonus;
}
export function addExerciseSet(p: Progression, set: ExerciseSet): Progression {
  if ((p.sets || []).some((s) => s.id === set.id)) return p;
  const missions = [...p.missions];
  for (const m of missionsForDay(p, set.day))
    if (!missions.some((x) => x.day === m.day && x.exercise === m.exercise))
      missions.push(m);
  return validateProgression({
    ...p,
    missions,
    sets: [...(p.sets || []), set],
  });
}
export function reviseExerciseSet(
  p: Progression,
  id: string,
  amount: number | null,
  now = Date.now(),
): Progression {
  const previous = (p.sets || []).find((s) => s.id === id);
  if (!previous) throw Error("Setul nu mai există.");
  if (previous.deleted) return p;
  return validateProgression({
    ...p,
    sets: (p.sets || []).map((s) =>
      s.id === id
        ? {
            ...s,
            amount: amount ?? s.amount,
            deleted: amount === null,
            updatedAt: Math.max(now, s.updatedAt + 1),
          }
        : s,
    ),
  });
}
export function setExerciseGoal(
  p: Progression,
  id: ExerciseId,
  target: number,
): Progression {
  return validateProgression({ ...p, goals: { ...p.goals, [id]: target } });
}
function mergeSets(a: ExerciseSet[], b: ExerciseSet[]) {
  const result = new Map(a.map((s) => [s.id, s]));
  for (const s of b) {
    const old = result.get(s.id);
    if (!old || (!old.deleted && (s.deleted || s.updatedAt > old.updatedAt)))
      result.set(s.id, s);
  }
  return [...result.values()];
}
