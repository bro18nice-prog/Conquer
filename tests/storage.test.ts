import test from "node:test";
import assert from "node:assert/strict";
import { createRepository, type Recording } from "../src/repository";
import { demoLoop } from "../src/core";
function setup() {
  const data = new Map<string, string>();
  let failKey = "";
  const repo = createRepository({
    getItem: async (k) => data.get(k) || null,
    setItem: async (k, v) => {
      if (k === failKey) throw new Error("disk full");
      data.set(k, v);
    },
  });
  return {
    data,
    repo,
    fail: (k: string) => {
      failKey = k;
    },
  };
}
const draft = (): Recording => ({
  id: "one",
  playerId: "owner",
  startedAt: Date.now() - 1e6,
  points: [],
  status: "recording",
  background: true,
});
test("GPS batches are serialized and timestamps deduplicated", async () => {
  const { repo } = setup();
  const points = demoLoop();
  await repo.write("recording", draft());
  await Promise.all([
    repo.appendLocations(points.slice(0, 20)),
    repo.appendLocations(points.slice(19, 40)),
    repo.appendLocations(points.slice(39)),
  ]);
  assert.equal((await repo.recording())!.points.length, points.length);
});
test("late GPS callbacks cannot mutate a stopped recording", async () => {
  const { repo } = setup();
  await repo.write("recording", draft());
  await repo.appendLocations(demoLoop());
  await repo.stopRecording();
  const before = await repo.recording();
  await repo.appendLocations([
    { ...demoLoop()[0], timestamp: Date.now() + 1000 },
  ]);
  assert.deepEqual(await repo.recording(), before);
});
test("failed final save retains the recoverable draft", async () => {
  const { repo, fail } = setup();
  await repo.write("recording", { ...draft(), points: demoLoop() });
  await repo.stopRecording();
  fail("conquer:runs");
  await assert.rejects(() => repo.finalize(), /disk full/);
  assert.ok(await repo.recording());
  fail("");
  const result = await repo.finalize();
  assert.equal(result!.runs.length, 1);
  assert.ok(result!.run.area > 0);
  assert.equal(await repo.recording(), null);
});
test("retry after failure to clear draft never duplicates a saved run", async () => {
  const { repo, fail } = setup();
  await repo.write("recording", { ...draft(), points: demoLoop() });
  await repo.stopRecording();
  fail("conquer:recording");
  await assert.rejects(() => repo.finalize());
  assert.equal((await repo.getRuns(false)).length, 1);
  fail("");
  assert.equal((await repo.finalize())!.runs.length, 1);
  assert.equal(await repo.finalize(), null);
});
test("run owner is bound at start and preserved through recovery", async () => {
  const { repo } = setup();
  await repo.write("recording", { ...draft(), points: demoLoop() });
  await repo.stopRecording();
  assert.equal((await repo.finalize())!.run.playerId, "owner");
});
test("demo and real history remain separate", async () => {
  const { repo } = setup();
  await repo.write("demo-runs", [{ id: "demo" }]);
  assert.deepEqual(await repo.getRuns(false), []);
});
test("corrupt local data is reported and not overwritten", async () => {
  const { repo, data } = setup();
  data.set("conquer:runs", "{bad");
  await assert.rejects(() => repo.getRuns(false));
  assert.equal(data.get("conquer:runs"), "{bad");
});

test("saved activity survives a new repository instance", async () => {
  const { repo, data } = setup();
  await repo.write("recording", { ...draft(), points: demoLoop() });
  await repo.stopRecording();
  await repo.finalize();
  const reopened = createRepository({
    getItem: async (k) => data.get(k) || null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  });
  assert.equal((await reopened.getRuns(false)).length, 1);
  assert.ok((await reopened.getRuns(false))[0].area > 0);
});
test("backup restores exact samples and duplicate import is idempotent", async () => {
  const a = setup(),
    b = setup();
  await a.repo.write("recording", {
    ...draft(),
    playerId: "me",
    points: demoLoop(),
  });
  await a.repo.stopRecording();
  await a.repo.finalize();
  const text = await a.repo.exportProgress();
  assert.equal((await b.repo.importProgress(text)).count, 1);
  assert.equal((await b.repo.importProgress(text)).count, 0);
  assert.deepEqual(
    (await b.repo.getRuns(false))[0].points,
    (await a.repo.getRuns(false))[0].points,
  );
});

test("malformed backup leaves existing progress intact", async () => {
  const { repo } = setup();
  await repo.write("runs", []);
  await assert.rejects(() =>
    repo.importProgress(
      JSON.stringify({ format: "conquer-backup", version: 1, runs: [{}] }),
    ),
  );
  assert.deepEqual(await repo.getRuns(false), []);
});
test("upgrade reprocesses a rejected legacy route without losing GPS samples", async () => {
  const { repo } = setup();
  const points = demoLoop();
  await repo.write("runs", [
    {
      id: "old",
      playerId: "me",
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      points,
      distance: 1300,
      area: 0,
      polygon: [],
      reason: "Buclă intersectată",
    },
  ]);
  const runs = await repo.upgradeRuns();
  assert.ok(runs[0].area > 100000);
  assert.deepEqual(runs[0].points, points);
  assert.equal((await repo.upgradeRuns())[0].area, runs[0].area);
});

test("GPS noise is dropped while recording", async () => {
  const { repo } = setup();
  await repo.write("recording", draft());
  const t = Date.now();
  const p = (lat: number, lon: number, s: number, acc = 5) => ({
    latitude: lat,
    longitude: lon,
    timestamp: t + s * 1000,
    accuracy: acc,
  });
  await repo.appendLocations([
    p(45, 25, 0),
    p(45.0001, 25, 5), // ~11 m in 5 s: kept
    p(45.01, 25, 8), // ~1 km jump: dropped
    p(45.0002, 25, 10, 60), // poor accuracy: dropped
    p(45.0002, 25, 12), // ~11 m from last good: kept
  ]);
  const r = await repo.recording();
  assert.equal(r?.points.length, 3);
});
