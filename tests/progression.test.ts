import test from "node:test";
import assert from "node:assert/strict";
import {
  addExerciseSet,
  reviseExerciseSet,
  setExerciseGoal,
  dailyMissions,
  WorkoutId,
  localDay,
  missionsForDay,
  updateMission,
  exerciseXP,
  totalXP,
  runXP,
  levelInfo,
  mergeProgression,
  validateProgression,
  dayNumber,
  Progression,
} from "../src/progression";
import { analyze, demoLoop, Run } from "../src/core";
import { createRepository } from "../src/repository";
const p = (): Progression => ({ startedDay: "2026-09-22", missions: [] });
test("daily missions start stable without automatic escalation", () => {
  assert.equal(missionsForDay(p(), "2026-09-22")[0].target, 5);
  assert.equal(missionsForDay(p(), "2026-09-23")[0].target, 5);
  assert.deepEqual(
    missionsForDay(p(), "2027-01-01").map((m) => m.target),
    [5, 10, 5],
  );
});
test("calendar progression is stable across daylight saving and year changes", () => {
  assert.equal(
    dayNumber({ startedDay: "2026-10-24", missions: [] }, "2026-10-26"),
    3,
  );
  assert.equal(
    dayNumber({ startedDay: "2026-12-31", missions: [] }, "2027-01-01"),
    2,
  );
});
test("repeated completion and editing completed missions cannot farm XP", () => {
  const once = updateMission(p(), "2026-09-22", "pushups");
  assert.equal(exerciseXP(once), 25);
  assert.deepEqual(updateMission(once, "2026-09-22", "pushups"), once);
  assert.deepEqual(updateMission(once, "2026-09-22", "pushups", 1), once);
});
test("all three give one daily bonus and next day starts incomplete", () => {
  let v = p();
  for (const id of ["pushups", "squats", "crunches"] as const)
    v = updateMission(v, "2026-09-22", id);
  assert.equal(exerciseXP(v), 100);
  assert.equal(
    missionsForDay(v, "2026-09-23").filter((m) => m.completed).length,
    0,
  );
  assert.equal(exerciseXP(updateMission(v, "2026-09-23", "pushups")), 125);
});
test("target adjustments retain same reward", () => {
  let v = updateMission(p(), "2026-09-22", "squats", 1);
  assert.equal(missionsForDay(v, "2026-09-22")[1].target, 1);
  assert.equal(exerciseXP(updateMission(v, "2026-09-22", "squats")), 30);
  assert.throws(() => updateMission(v, "2026-09-22", "pushups", 0));
});
test("level boundary and overflow preserve XP", () => {
  assert.deepEqual(levelInfo(100), {
    level: 2,
    xp: 0,
    required: 150,
    total: 100,
    ratio: 0,
  });
  assert.equal(levelInfo(250).level, 3);
  assert.equal(levelInfo(249).xp, 149);
  assert.equal(levelInfo(451).xp, 1);
});
const run = (): Run => {
  const points = demoLoop();
  return {
    id: "real",
    playerId: "me",
    startedAt: points[0].timestamp,
    finishedAt: points.at(-1)!.timestamp,
    points,
    ...analyze(points),
  };
};
test("real routes award XP once even with duplicate IDs", () => {
  const r = run();
  assert.ok(runXP(r) > 0);
  assert.equal(totalXP(p(), [r, r]), runXP(r));
  assert.equal(totalXP(p(), [{ ...r, id: "seed-1" }]), 0);
});
test("implausible speed earns no route XP", () => {
  const r = run();
  r.points = r.points.map((p, i) => ({ ...p, timestamp: 1000 + i * 100 }));
  assert.equal(runXP(r), 0);
});
test("backup merge retains completions and never doubles rewards", () => {
  const a = updateMission(p(), "2026-09-22", "pushups"),
    b = updateMission(p(), "2026-09-22", "squats");
  assert.equal(exerciseXP(mergeProgression(a, b)), 55);
  assert.equal(exerciseXP(mergeProgression(a, a)), 25);
  assert.throws(() =>
    validateProgression({ ...a, missions: [...a.missions, ...a.missions] }),
  );
  assert.throws(() => validateProgression({ ...a, startedDay: "2026-02-30" }));
});
function repo() {
  const data = new Map<string, string>();
  return createRepository({
    getItem: async (k) => data.get(k) || null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  });
}
test("concurrent completion persists one reward", async () => {
  const r = repo();
  await r.ensureProgression();
  await Promise.all([
    r.changeMission(localDay(), "pushups"),
    r.changeMission(localDay(), "pushups"),
  ]);
  assert.equal(exerciseXP(await r.getProgression()), 25);
  await assert.rejects(() => r.changeMission("2000-01-01", "pushups"));
});
test("XP backup roundtrip preserves completions and supports old backups", async () => {
  const a = repo(),
    b = repo();
  await a.changeMission(localDay(), "pushups");
  await b.importProgress(await a.exportProgress());
  await b.importProgress(await a.exportProgress());
  assert.equal(exerciseXP(await b.getProgression()), 25);
  await b.importProgress(
    JSON.stringify({ format: "conquer-backup", version: 1, runs: [] }),
  );
  assert.equal(exerciseXP(await b.getProgression()), 25);
});

test("1 versus 20 pushups earns proportional XP, goals do not cap sets", () => {
  assert.equal(exerciseXP(add(p(), "a", "pushups", 1)), 3);
  assert.equal(exerciseXP(add(p(), "a", "pushups", 20)), 60);
});
test("split sets accumulate; bonus is awarded once and undo recalculates", () => {
  let a = add(p(), "a", "pushups", 2);
  a = add(a, "b", "pushups", 3);
  a = add(a, "c", "squats", 10);
  a = add(a, "d", "crunches", 5);
  assert.equal(exerciseXP(a), 65);
  assert.equal(
    dailyMissions(a, "2026-09-22").filter((m) => m.completed).length,
    3,
  );
  a = add(a, "e", "pushups", 20);
  assert.equal(exerciseXP(a), 125);
  a = reviseExerciseSet(a, "d", null);
  assert.equal(exerciseXP(a), 95);
});
test("plank seconds aggregate across sets without rounding loss", () => {
  let a = add(p(), "a", "plank", 2);
  a = add(a, "b", "plank", 3);
  assert.equal(exerciseXP(a), 1);
  a = reviseExerciseSet(a, "b", 8);
  assert.equal(exerciseXP(a), 2);
});
test("goal settings lock once a day starts and do not escalate", () => {
  let a = setExerciseGoal(p(), "pushups", 10);
  a = add(a, "a", "pushups", 5);
  a = setExerciseGoal(a, "pushups", 1);
  assert.equal(missionsForDay(a, "2026-09-22")[0].target, 10);
  assert.equal(missionsForDay(a, "2026-09-23")[0].target, 1);
  assert.equal(missionsForDay(a, "2027-01-01")[0].target, 1);
});
test("deleted sets cannot return from stale backups in either merge direction", () => {
  const a = add(p(), "a", "pushups", 20),
    b = reviseExerciseSet(a, "a", null);
  assert.equal(exerciseXP(mergeProgression(a, b)), 0);
  assert.equal(exerciseXP(mergeProgression(b, a)), 0);
  assert.equal(exerciseXP(mergeProgression(a, a)), 60);
});
test("newer edit wins regardless of import order", () => {
  const a = add(p(), "a", "pushups", 20),
    b = reviseExerciseSet(a, "a", 10);
  assert.equal(exerciseXP(mergeProgression(a, b)), 30);
  assert.equal(exerciseXP(mergeProgression(b, a)), 30);
});
test("legacy XP is preserved once alongside new reps", () => {
  const old = updateMission(p(), "2026-09-22", "pushups");
  const current = add(validateProgression(old), "new", "pushups", 20);
  assert.equal(exerciseXP(current), 85);
  assert.equal(exerciseXP(mergeProgression(current, old)), 85);
});
test("invalid sets and goals are rejected before persistence", () => {
  assert.throws(() => add(p(), "a", "plank", 3601));
  assert.throws(() => add(p(), "a", "pushups", 0));
  assert.throws(() => add(p(), "a", "pushups", 1.5));
  assert.throws(() => setExerciseGoal(p(), "pushups", 101));
  assert.throws(() => validateProgression({ ...p(), sets: [{ id: "bad" }] }));
});
test("concurrent set saves and duplicate retry survive a backup roundtrip", async () => {
  const a = repo(),
    b = repo(),
    now = Date.now();
  const first = {
    id: "first",
    day: localDay(),
    exercise: "pushups" as const,
    amount: 20,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await Promise.all([
    a.recordExercise(first),
    a.recordExercise({ ...first, id: "second" }),
    a.recordExercise(first),
  ]);
  assert.equal(exerciseXP(await a.getProgression()), 120);
  await b.importProgress(await a.exportProgress());
  await b.importProgress(await a.exportProgress());
  assert.equal(exerciseXP(await b.getProgression()), 120);
  await b.reviseExercise("first", null);
  await b.importProgress(await a.exportProgress());
  assert.equal(exerciseXP(await b.getProgression()), 60);
});
function add(p: Progression, id: string, exercise: WorkoutId, amount: number) {
  return addExerciseSet(p, {
    id,
    day: "2026-09-22",
    exercise,
    amount,
    createdAt: 100,
    updatedAt: 100,
    deleted: false,
  });
}
