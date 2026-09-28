import test from "node:test";
import assert from "node:assert/strict";
import pc from "polygon-clipping";
import {
  analyze,
  area,
  conquer,
  demoLoop,
  distance,
  territoriesFromRuns,
  validPoint,
  type Run,
} from "../src/core";

test("a real-sized closed loop captures approximately 106,000 m²", () => {
  const r = analyze(demoLoop());
  assert.ok(r.area > 100000 && r.area < 110000);
  assert.ok(r.distance > 1200 && r.distance < 1400);
});
test("an open route saves distance but captures no area", () => {
  const r = analyze(demoLoop().slice(0, 50));
  assert.equal(r.area, 0);
  assert.match(r.reason, /deschis/);
  assert.ok(r.distance > 200);
});
test("a high-speed route captures nothing", () => {
  const r = analyze(
    demoLoop().map((p, i) => ({ ...p, timestamp: 1000 + i * 100 })),
  );
  assert.equal(r.area, 0);
  assert.match(r.reason, /viteză/);
});
test("a missing GPS interval is not bridged into a claim", () => {
  const p = demoLoop();
  p.forEach((x, i) => {
    if (i > 35) x.timestamp += 150000;
  });
  assert.equal(analyze(p).area, 0);
});
test("backwards and repeated timestamps invalidate a claim", () => {
  for (const delta of [0, -1000]) {
    const p = demoLoop();
    p[20].timestamp = p[19].timestamp + delta;
    assert.equal(analyze(p).area, 0);
  }
});
test("poor accuracy is excluded and invalid coordinates are not usable", () => {
  assert.equal(validPoint({ ...demoLoop()[0], accuracy: 100 }), false);
  assert.equal(validPoint({ ...demoLoop()[0], latitude: NaN }), false);
  assert.equal(validPoint({ ...demoLoop()[0], longitude: 190 }), false);
  assert.equal(
    analyze(demoLoop().map((p) => ({ ...p, accuracy: 100 }))).area,
    0,
  );
});
test("a stationary GPS trace does not claim territory", () => {
  const p = demoLoop()[0];
  assert.equal(
    analyze(
      Array.from({ length: 10 }, (_, i) => ({
        ...p,
        timestamp: p.timestamp + i * 3000,
      })),
    ).area,
    0,
  );
});
test("capturing the same area twice does not double the score", () => {
  const p = analyze(demoLoop()).polygon;
  const once = conquer([], "a", p);
  const twice = conquer(once, "a", p);
  assert.equal(twice.length, 1);
  assert.ok(Math.abs(once[0].area - twice[0].area) < 0.1);
});
test("partial overlap is removed from the previous owner", () => {
  const a = analyze(demoLoop()).polygon,
    b = analyze(demoLoop(44.439, 26.088)).polygon;
  const ts = conquer(conquer([], "a", a), "b", b);
  assert.ok(ts.find((t) => t.playerId === "a")!.area < area(a));
  assert.equal(pc.intersection(ts[0].polygon, ts[1].polygon).length, 0);
  assert.ok(
    Math.abs(ts.reduce((s, t) => s + t.area, 0) - area(pc.union(a, b))) < 0.1,
  );
});
test("full takeover removes the old owner", () => {
  const p = analyze(demoLoop()).polygon;
  const ts = conquer(conquer([], "a", p), "b", p);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].playerId, "b");
});
test("a claim within an old claim preserves a hole", () => {
  const a = analyze(demoLoop(44.438, 26.086, 2)).polygon,
    b = analyze(demoLoop(44.439, 26.087, 0.5)).polygon;
  const ts = conquer(conquer([], "a", a), "b", b);
  assert.equal(ts.find((t) => t.playerId === "a")!.polygon[0].length, 2);
  assert.ok(Math.abs(ts.reduce((s, t) => s + t.area, 0) - area(a)) < 0.1);
});
test("replaying duplicate run ids is idempotent", () => {
  const points = demoLoop();
  const r: Run = {
    id: "one",
    playerId: "a",
    startedAt: points[0].timestamp,
    finishedAt: points.at(-1)!.timestamp,
    points,
    ...analyze(points),
  };
  assert.deepEqual(territoriesFromRuns([r, r]), territoriesFromRuns([r]));
});
test("capture ordering is independent of input array ordering", () => {
  const points = demoLoop();
  const a: Run = {
    id: "a",
    playerId: "a",
    startedAt: 0,
    finishedAt: 1,
    points,
    ...analyze(points),
  };
  const b = { ...a, id: "b", playerId: "b", finishedAt: 2 };
  assert.deepEqual(territoriesFromRuns([a, b]), territoriesFromRuns([b, a]));
  assert.equal(territoriesFromRuns([b, a])[0].playerId, "b");
});
test("haversine distance is symmetric and zero at the same point", () => {
  const p = demoLoop();
  assert.equal(distance(p[0], p[0]), 0);
  assert.ok(Math.abs(distance(p[0], p[20]) - distance(p[20], p[0])) < 1e-8);
});

const path = (coords: number[][]) => {
  let result: ReturnType<typeof demoLoop> = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1],
      b = coords[i];
    for (let j = 0; j < 10; j++)
      result.push({
        longitude: 26 + (a[0] + ((b[0] - a[0]) * j) / 10) * 0.001,
        latitude: 44 + (a[1] + ((b[1] - a[1]) * j) / 10) * 0.001,
        accuracy: 5,
        timestamp: 1000000 + result.length * 10000,
      });
  }
  const end = coords.at(-1)!;
  result.push({
    longitude: 26 + end[0] * 0.001,
    latitude: 44 + end[1] * 0.001,
    accuracy: 5,
    timestamp: 1000000 + result.length * 10000,
  });
  return result;
};
test("GPS crossing at return keeps the main enclosed surface", () => {
  const r = analyze(
    path([
      [0, 0],
      [0, 3],
      [3, 3],
      [3, 0],
      [-0.04, 0.03],
      [0.04, -0.03],
      [0, 0],
    ]),
  );
  assert.ok(r.area > 70000 && r.area < 85000);
});
test("a figure eight captures its two bounded lobes", () => {
  const r = analyze(
    path([
      [0, 0],
      [3, 3],
      [0, 3],
      [3, 0],
      [0, 0],
    ]),
  );
  assert.ok(r.area > 35000 && r.area < 45000);
});
test("Paper-style excursion closes against an owned edge", () => {
  const own = analyze(
    path([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]),
  ).polygon;
  const points = path([
    [1.7, 0.2],
    [3, 0.2],
    [3, 1.8],
    [1.7, 1.8],
  ]);
  assert.ok(distance(points[0], points.at(-1)!) > 40);
  const r = analyze(points, own);
  assert.ok(r.area > 13000 && r.area < 15000);
  assert.equal(pc.intersection(own, r.polygon).length, 0);
});
test("reversing an excursion gives the same new area", () => {
  const own = analyze(
    path([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]),
  ).polygon;
  const coords = [
    [1.7, 0.2],
    [3, 0.2],
    [3, 1.8],
    [1.7, 1.8],
  ];
  assert.ok(
    Math.abs(
      analyze(path(coords), own).area -
        analyze(path([...coords].reverse()), own).area,
    ) < 0.1,
  );
});
test("an unfinished excursion does not use an invented closing chord", () => {
  const own = analyze(
    path([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]),
  ).polygon;
  assert.equal(
    analyze(
      path([
        [1.7, 0.2],
        [3, 0.2],
        [3, 1.8],
      ]),
      own,
    ).area,
    0,
  );
});
test("walking wholly inside territory adds no land", () => {
  const own = analyze(
    path([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ]),
  ).polygon;
  assert.equal(
    analyze(
      path([
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ]),
      own,
    ).area,
    0,
  );
});
test("disconnected territories do not invent a bridge", () => {
  const a = analyze(
      path([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ]),
    ).polygon,
    b = analyze(
      path([
        [5, 0],
        [7, 0],
        [7, 2],
        [5, 2],
        [5, 0],
      ]),
    ).polygon;
  assert.equal(
    analyze(
      path([
        [1, 1],
        [6, 1],
      ]),
      pc.union(a, b),
    ).area,
    0,
  );
});
test("a route inside owned land never fills an untouched hole", () => {
  const outer = analyze(
      path([
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
        [0, 0],
      ]),
    ).polygon,
    inner = analyze(
      path([
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ]),
    ).polygon;
  assert.equal(
    analyze(
      path([
        [0.5, 0.5],
        [5, 0.5],
        [5, 1],
        [0.5, 1],
        [0.5, 0.5],
      ]),
      pc.difference(outer, inner),
    ).area,
    0,
  );
});
