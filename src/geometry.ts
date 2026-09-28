import pc, { MultiPolygon } from "polygon-clipping";
type XY = [number, number];
type Segment = { a: XY; b: XY; trail: boolean; cuts: number[] };
const EPS = 1e-10;
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const at = (s: Segment, t: number): XY => [
  s.a[0] + (s.b[0] - s.a[0]) * t,
  s.a[1] + (s.b[1] - s.a[1]) * t,
];
function inRing(p: XY, r: number[][]) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      b = r[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function insideOwned(p: XY, own: MultiPolygon) {
  return own.some(
    (poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)),
  );
}
// RDP changes only the capture contour; the original GPS samples stay in history.
export function simplifyTrace(points: XY[], meters = 3): XY[] {
  if (points.length < 3) return points;
  const scale = Math.cos((points[0][1] * Math.PI) / 180),
    tol = (meters / 111195) ** 2;
  const d2 = (p: XY, a: XY, b: XY) => {
    const dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1],
      px = (p[0] - a[0]) * scale,
      py = p[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
    );
    return (px - dx * t) ** 2 + (py - dy * t) ** 2;
  };
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = tol,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = d2(points[i], points[a], points[b]);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
// Node the GPS line together with owned borders and walk each bounded planar face.
// No straight chord is added to an open excursion. Owned borders supply its closure.
export function captureFaces(
  raw: XY[],
  own: MultiPolygon,
  close: boolean,
): MultiPolygon {
  const trace = simplifyTrace(raw),
    segments: Segment[] = [];
  const add = (a: XY, b: XY, trail: boolean) => {
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > EPS)
      segments.push({ a, b, trail, cuts: [0, 1] });
  };
  for (let i = 1; i < trace.length; i++) add(trace[i - 1], trace[i], true);
  if (close && trace.length > 2) add(trace.at(-1)!, trace[0], true);
  for (const poly of own)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) add(ring[i - 1], ring[i], false);
  // Intersections include exact return points, crossings, and collinear retracing.
  const cut = (s: Segment, t: number) => {
    if (t >= -EPS && t <= 1 + EPS) s.cuts.push(Math.max(0, Math.min(1, t)));
  };
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j];
      if (
        Math.max(a.a[0], a.b[0]) + EPS < Math.min(b.a[0], b.b[0]) ||
        Math.max(b.a[0], b.b[0]) + EPS < Math.min(a.a[0], a.b[0]) ||
        Math.max(a.a[1], a.b[1]) + EPS < Math.min(b.a[1], b.b[1]) ||
        Math.max(b.a[1], b.b[1]) + EPS < Math.min(a.a[1], a.b[1])
      )
        continue;
      const r = sub(a.b, a.a),
        s = sub(b.b, b.a),
        q = sub(b.a, a.a),
        den = cross(r, s);
      if (Math.abs(den) > 1e-20) {
        const t = cross(q, s) / den,
          u = cross(q, r) / den;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
          cut(a, t);
          cut(b, u);
        }
      } else if (Math.abs(cross(q, r)) < 1e-18) {
        const project = (p: XY, z: Segment) => {
          const v = sub(z.b, z.a),
            w = sub(p, z.a);
          return (v[0] * w[0] + v[1] * w[1]) / (v[0] ** 2 + v[1] ** 2);
        };
        cut(a, project(b.a, a));
        cut(a, project(b.b, a));
        cut(b, project(a.a, b));
        cut(b, project(a.b, b));
      }
    }
  const nodes: XY[] = [],
    ids = new Map<string, number>(),
    adj = new Map<number, Set<number>>(),
    trailEdges = new Set<string>();
  const key = (a: number, b: number) => (a < b ? a + ":" + b : b + ":" + a);
  const node = (p: XY) => {
    const k = Math.round(p[0] / EPS) + "," + Math.round(p[1] / EPS);
    let id = ids.get(k);
    if (id === undefined) {
      id = nodes.length;
      ids.set(k, id);
      nodes.push(p);
      adj.set(id, new Set());
    }
    return id;
  };
  for (const s of segments) {
    s.cuts.sort((a, b) => a - b);
    for (let i = 1; i < s.cuts.length; i++) {
      if (s.cuts[i] - s.cuts[i - 1] < EPS) continue;
      const a = node(at(s, s.cuts[i - 1])),
        b = node(at(s, s.cuts[i]));
      if (a === b) continue;
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
      if (s.trail && !insideOwned(at(s, (s.cuts[i] + s.cuts[i - 1]) / 2), own))
        trailEdges.add(key(a, b));
    }
  }
  const neighbors = new Map(
    [...adj].map(([id, others]) => [
      id,
      [...others].sort(
        (a, b) =>
          Math.atan2(nodes[a][1] - nodes[id][1], nodes[a][0] - nodes[id][0]) -
          Math.atan2(nodes[b][1] - nodes[id][1], nodes[b][0] - nodes[id][0]),
      ),
    ]),
  );
  const visited = new Set<string>(),
    faces: MultiPolygon = [];
  for (const [start, others] of neighbors)
    for (const next of others) {
      if (visited.has(start + ":" + next)) continue;
      const ring: XY[] = [];
      let a = start,
        b = next,
        hasTrail = false,
        closed = false;
      for (
        let steps = 0;
        steps <= segments.length * 8 + nodes.length * 4;
        steps++
      ) {
        const directed = a + ":" + b;
        if (visited.has(directed)) break;
        visited.add(directed);
        ring.push(nodes[a]);
        hasTrail ||= trailEdges.has(key(a, b));
        const around = neighbors.get(b)!;
        const c =
          around[(around.indexOf(a) - 1 + around.length) % around.length];
        a = b;
        b = c;
        if (a === start && b === next) {
          closed = true;
          break;
        }
      }
      if (!closed || !hasTrail || ring.length < 3) continue;
      let signed = 0;
      for (let i = 0; i < ring.length; i++)
        signed +=
          (ring[i][0] - ring[0][0]) *
            (ring[(i + 1) % ring.length][1] - ring[0][1]) -
          (ring[(i + 1) % ring.length][0] - ring[0][0]) *
            (ring[i][1] - ring[0][1]);
      if (signed <= 1e-14) continue;
      ring.push(ring[0]);
      faces.push([ring]);
    }
  if (!faces.length) return [];
  return pc.difference(pc.union(faces), own);
}
