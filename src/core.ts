import pc, { MultiPolygon } from "polygon-clipping";
import { captureFaces } from "./geometry";
export type Point = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
};
export type Player = { id: string; name: string; color: string };
export type Run = {
  id: string;
  playerId: string;
  startedAt: number;
  finishedAt: number;
  points: Point[];
  distance: number;
  area: number;
  reason: string;
  polygon: MultiPolygon;
  synced?: boolean;
  captureVersion?: number;
};
export type Territory = {
  playerId: string;
  polygon: MultiPolygon;
  area: number;
};
export const COLORS = ["#d5fc51", "#a68bfa", "#54c9e9", "#ff9a76", "#ed89c5"];
export const ME: Player = { id: "me", name: "Tu", color: COLORS[0] };
const rad = Math.PI / 180;
export function distance(a: Point, b: Point) {
  const dlat = (b.latitude - a.latitude) * rad,
    dlon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dlon / 2) ** 2;
  return (
    6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export function validPoint(p: Point) {
  return (
    [p.latitude, p.longitude, p.timestamp, p.accuracy].every(Number.isFinite) &&
    Math.abs(p.latitude) <= 85 &&
    Math.abs(p.longitude) <= 180 &&
    p.accuracy >= 0 &&
    p.accuracy <= 35
  );
}
export function length(points: Point[]) {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
}
function ringArea(r: number[][]) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++)
    a +=
      (r[i + 1][0] - r[i][0]) *
      rad *
      (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad));
  return Math.abs((a * 6371008.8 ** 2) / 2);
}
export function area(p: MultiPolygon) {
  return p.reduce(
    (s, r) =>
      s +
      Math.max(
        0,
        ringArea(r[0]) - r.slice(1).reduce((v, h) => v + ringArea(h), 0),
      ),
    0,
  );
}
export function analyze(
  points: Point[],
  owned: MultiPolygon = [],
): { distance: number; area: number; polygon: MultiPolygon; reason: string } {
  const clean = points.filter(validPoint),
    dist = length(clean);
  const reject = (reason: string) => ({
    distance: dist,
    area: 0,
    polygon: [] as MultiPolygon,
    reason,
  });
  if (points.length > 10000)
    return reject("Activitatea depășește limita de 10.000 de puncte GPS.");
  if (
    points.length &&
    points.at(-1)!.timestamp - points[0].timestamp > 21600000
  )
    return reject("Durata maximă în pilot este de 6 ore.");
  if (clean.length < 4)
    return reject("Prea puține puncte GPS pentru o captură.");
  for (let i = 1; i < clean.length; i++) {
    const dt = (clean[i].timestamp - clean[i - 1].timestamp) / 1000;
    if (dt <= 0 || dt > 120 || distance(clean[i - 1], clean[i]) / dt > 8)
      return reject(
        "Traseu salvat fără captură: întrerupere GPS sau viteză nevalidă.",
      );
  }
  if (dist < 200) return reject("Pentru captură, parcurge cel puțin 200 m.");
  const close = distance(clean[0], clean.at(-1)!) <= 40;
  const polygon = captureFaces(
    clean.map((p) => [p.longitude, p.latitude]),
    owned,
    close,
  );
  const m2 = area(polygon);
  if (m2 < 500)
    return reject(
      close
        ? "Suprafața nouă minimă este 500 m²."
        : "Traseu deschis: revino aproape de start sau reintră în teritoriul tău.",
    );
  if (m2 > 1e7) return reject("Suprafața depășește limita pilotului: 10 km².");
  return {
    distance: dist,
    area: m2,
    polygon,
    reason: owned.length ? "Teritoriu extins" : "Teritoriu cucerit",
  };
}
export function conquer(
  existing: Territory[],
  owner: string,
  polygon: MultiPolygon,
): Territory[] {
  if (!polygon.length) return existing;
  const result: Territory[] = [];
  let own = polygon;
  for (const t of existing) {
    if (t.playerId === owner) own = pc.union(own, t.polygon);
    else {
      const p = pc.difference(t.polygon, polygon);
      if (p.length)
        result.push({ playerId: t.playerId, polygon: p, area: area(p) });
    }
  }
  result.push({ playerId: owner, polygon: own, area: area(own) });
  return result;
}
export function territoriesFromRuns(runs: Run[]) {
  return [...new Map(runs.map((r) => [r.id, r])).values()]
    .sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))
    .reduce((ts, r) => conquer(ts, r.playerId, r.polygon), [] as Territory[]);
}
export const km = (m: number) => (m / 1000).toFixed(2);
export const km2 = (m: number) => (m / 1e6).toFixed(3);
export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return (
    Math.floor(s / 60)
      .toString()
      .padStart(2, "0") +
    ":" +
    (s % 60).toString().padStart(2, "0")
  );
}
export function demoLoop(
  lat = 44.438,
  lng = 26.086,
  scale = 1,
  at = Date.now() - 1e6,
): Point[] {
  const corners = [
      [lat, lng],
      [lat + 0.003 * scale, lng],
      [lat + 0.003 * scale, lng + 0.004 * scale],
      [lat, lng + 0.004 * scale],
      [lat, lng],
    ],
    pts: Point[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 20; j++)
      pts.push({
        latitude:
          corners[i][0] + ((corners[i + 1][0] - corners[i][0]) * j) / 20,
        longitude:
          corners[i][1] + ((corners[i + 1][1] - corners[i][1]) * j) / 20,
        timestamp: at + pts.length * 8000,
        accuracy: 5,
      });
  pts.push({
    latitude: lat,
    longitude: lng,
    timestamp: at + pts.length * 8000,
    accuracy: 5,
  });
  return pts;
}
export const demoPlayers: Player[] = [
  "Tu",
  "Alex",
  "Mara",
  "Vlad",
  "Daria",
].map((name, i) => ({ id: i ? "demo-" + i : "me", name, color: COLORS[i] }));
export function demoRuns(): Run[] {
  return demoPlayers.map((p, i) => {
    const points = demoLoop(
      44.431 + i * 0.0026,
      26.077 + (i % 3) * 0.005,
      1.1,
      Date.now() - (5 - i) * 86400000,
    );
    return {
      id: "seed-" + i,
      playerId: p.id,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      points,
      ...analyze(points),
    };
  });
}

export function recalculateRuns(input: Run[]): Run[] {
  let territories: Territory[] = [];
  return [...input]
    .sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))
    .map((r) => {
      const next = r.synced
        ? r
        : {
            ...r,
            ...analyze(
              r.points,
              territories.find((t) => t.playerId === r.playerId)?.polygon || [],
            ),
            captureVersion: 2,
          };
      territories = conquer(territories, next.playerId, next.polygon);
      return next;
    });
}
