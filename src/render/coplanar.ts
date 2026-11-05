// Finds z-fighting in built geometry: two triangles in one plane, facing the same way, overlapping
// with real area, from different parts (`tag`). Used by the prop and building geometry tests.

type V3 = readonly [number, number, number];

export interface Tri {
  a: V3;
  b: V3;
  c: V3;
  /** Triangles with the same tag never count against each other (a part, a colour, a building). */
  tag: string;
}

export interface Overlap {
  tags: [string, string];
  /** Unit normal and offset (n · p) of the shared plane. */
  normal: V3;
  offset: number;
  /** Overlapping area, m² (summed over the triangle pairs of these two tags in this plane). */
  area: number;
  /** A point in the overlap. */
  at: V3;
}

export interface CoplanarOptions {
  /** Max distance between the planes, m. */
  planeEps?: number;
  /** Min |n1 · n2| (same direction only: back faces are culled). */
  normalDot?: number;
  /** Min overlap per tag pair and plane to report, m². Touching edges have zero area. */
  minArea?: number;
}

interface Prepared {
  tri: Tri;
  n: V3;
  d: number;
}

const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

type P2 = [number, number];

/** Signed area of a 2D polygon. */
function area2(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Clip convex `subject` by convex `clip` (both counter-clockwise), Sutherland–Hodgman. */
function clipConvex(subject: P2[], clip: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
    const side = (p: P2) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/** Every pair of tags whose triangles share a plane and overlap, largest first. */
export function coplanarOverlaps(tris: Tri[], opts: CoplanarOptions = {}): Overlap[] {
  const planeEps = opts.planeEps ?? 0.001, normalDot = opts.normalDot ?? 0.999, minArea = opts.minArea ?? 1e-4;
  // Bucket by quantised normal and offset; a pair can straddle a bin edge, so look one bin up too.
  const buckets = new Map<string, Prepared[]>();
  const nq = (v: number) => Math.round(v * 50);
  const keyOf = (n: V3, bin: number) => `${nq(n[0])},${nq(n[1])},${nq(n[2])}|${bin}`;
  const prepared: Prepared[] = [];
  for (const tri of tris) {
    const c = cross(sub(tri.b, tri.a), sub(tri.c, tri.a));
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len < 1e-9) continue;
    const n: V3 = [c[0] / len, c[1] / len, c[2] / len];
    const p = { tri, n, d: dot(n, tri.a) };
    prepared.push(p);
    const key = keyOf(n, Math.floor(p.d / planeEps));
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(p);
  }

  const found = new Map<string, Overlap>();
  // Per bucket: one basis for the plane, every triangle flattened into it with its bounding box,
  // then a sweep along u so only triangles whose boxes cross are clipped.
  interface Flat { p: Prepared; poly: P2[]; u0: number; u1: number; v0: number; v1: number; up: boolean }
  const flatten = (list: Prepared[], up: boolean, uu: V3, vv: V3): Flat[] =>
    list.map((p) => {
      const poly = [p.tri.a, p.tri.b, p.tri.c].map((v) => [dot(v, uu), dot(v, vv)] as P2);
      if (area2(poly) < 0) poly.reverse();
      const us = poly.map((q) => q[0]), vs = poly.map((q) => q[1]);
      return { p, poly, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), up };
    });
  const compare = (A: Flat, B: Flat) => {
    const p = A.p, q = B.p;
    if (p.tri.tag === q.tri.tag || dot(p.n, q.n) < normalDot || Math.abs(p.d - q.d) > planeEps) return;
    if (A.v1 <= B.v0 || B.v1 <= A.v0) return;
    const overlap = clipConvex(A.poly, B.poly);
    if (overlap.length < 3) return;
    const a = Math.abs(area2(overlap));
    if (a < 1e-8) return;
    const tags = [p.tri.tag, q.tri.tag].sort() as [string, string];
    const key = `${tags[0]}|${tags[1]}|${nq(p.n[0])},${nq(p.n[1])},${nq(p.n[2])}|${Math.round(p.d / planeEps)}`;
    const prev = found.get(key);
    if (prev) prev.area += a;
    else {
      const cx = overlap.reduce((s, v) => s + v[0], 0) / overlap.length, cy = overlap.reduce((s, v) => s + v[1], 0) / overlap.length;
      found.set(key, { tags, normal: p.n, offset: p.d, area: a, at: centre(p, cx, cy) });
    }
  };
  let basis: { uu: V3; vv: V3 };
  const centre = (p: Prepared, cx: number, cy: number): V3 => {
    const { uu, vv } = basis;
    return [p.n[0] * p.d + uu[0] * cx + vv[0] * cy, p.n[1] * p.d + uu[1] * cx + vv[1] * cy, p.n[2] * p.d + uu[2] * cx + vv[2] * cy];
  };
  for (const [key, list] of buckets) {
    const [nkey, bin] = key.split('|');
    const up = buckets.get(`${nkey}|${Number(bin) + 1}`) ?? [];
    if (list.length + up.length < 2) continue;
    const tag0 = list[0].tri.tag;
    if (list.every((p) => p.tri.tag === tag0) && up.every((p) => p.tri.tag === tag0)) continue; // one part's own faces
    const n = list[0].n;
    const helper: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(helper, n), ul = Math.hypot(u[0], u[1], u[2]);
    const uu: V3 = [u[0] / ul, u[1] / ul, u[2] / ul];
    basis = { uu, vv: cross(n, uu) };
    const flat = [...flatten(list, false, uu, basis.vv), ...flatten(up, true, uu, basis.vv)].sort((x, y) => x.u0 - y.u0);
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length && flat[j].u0 < flat[i].u1; j++) {
        if (flat[i].up && flat[j].up) continue; // that pair is the next bin's own
        compare(flat[i], flat[j]);
      }
    }
  }
  return [...found.values()].filter((o) => o.area >= minArea).sort((x, y) => y.area - x.area);
}

/** Triangles of a non-indexed or indexed geometry's arrays, tagged per triangle by `tagOf(first vertex index)`. */
export function trianglesOf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  tagOf: (vertex: number) => string,
): Tri[] {
  const count = indices ? indices.length : positions.length / 3;
  const v = (i: number): V3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const out: Tri[] = [];
  for (let k = 0; k + 2 < count; k += 3) {
    const i0 = indices ? indices[k] : k, i1 = indices ? indices[k + 1] : k + 1, i2 = indices ? indices[k + 2] : k + 2;
    out.push({ a: v(i0), b: v(i1), c: v(i2), tag: tagOf(i0) });
  }
  return out;
}

/** Tag by vertex colour (hex): same-colour parts in one plane draw the same pixels, so they don't show. */
export function colourTag(colors: ArrayLike<number>): (vertex: number) => string {
  return (i) => {
    const h = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${h(colors[i * 3])}${h(colors[i * 3 + 1])}${h(colors[i * 3 + 2])}`;
  };
}
