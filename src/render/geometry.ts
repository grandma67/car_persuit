import * as THREE from 'three';
import type { GeometryBuilder } from '../world/CityBuilder';
import { groundHeight, type Terrain } from '../world/Terrain';

/**
 * Vertex-coloured part for merging into one flat-shaded mesh (one material for many colours).
 * Always non-indexed and without UVs, so any mix of boxes, cylinders, cones and spheres merges.
 */
export function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/**
 * A strip `width` wide along a polyline, draped `lift` over the ground, facing up (paths, tracks,
 * boardwalk shadows). Corners are mitred (capped at twice the half width on sharp turns).
 */
export function drapePolyline(flat: GeometryBuilder, points: { x: number; z: number }[], width: number, lift: number, color: THREE.Color, terrain: Terrain): void {
  if (points.length < 2) return;
  const h = width / 2;
  const edge = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
    // Mitre: scale the normal so the strip keeps its width through the bend.
    if (i > 0 && i < points.length - 1) {
      const p0 = points[i - 1], s = Math.hypot(p.x - p0.x, p.z - p0.z) || 1;
      const cos = Math.abs((-(p.z - p0.z) / s) * nx + ((p.x - p0.x) / s) * nz);
      const k = 1 / Math.max(0.5, cos);
      nx *= k;
      nz *= k;
    }
    const v = (x: number, z: number) => [x, groundHeight(terrain, x, z) + lift, z];
    return [v(p.x + nx * h, p.z + nz * h), v(p.x - nx * h, p.z - nz * h)];
  });
  for (let i = 1; i < edge.length; i++) {
    const [l0, r0] = edge[i - 1], [l1, r1] = edge[i];
    upTri(flat, l0, r0, r1, color);
    upTri(flat, l0, r1, l1, color);
  }
}

/** Push a flat triangle facing up (wound either way in). */
export function upTri(flat: GeometryBuilder, a: number[], b: number[], c: number[], color: THREE.Color): void {
  const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const pts = up >= 0 ? [a, b, c] : [a, c, b];
  flat.quad([pts[0], pts[1], pts[2], pts[2]], [0, 1, 0], color);
}

/**
 * Drops the triangles a merged model can never show: those lying wholly inside (or on the surface
 * of) another of its closed convex parts, such as a pole's end cap buried in its base or a rail's end
 * flush with a post's face. Safe from every angle, so a knocked-loose prop tumbling over still looks
 * whole (an underside on the ground is kept). Parts are found by welding positions; a part that isn't
 * closed or isn't convex hides nothing. Works on `part()`'s non-indexed geometry; returns it as is
 * when nothing is hidden.
 */
export function dropHiddenFaces(geo: THREE.BufferGeometry, eps = 1e-4): THREE.BufferGeometry {
  const keep = visibleTriangles(geo, eps);
  return keep ? keepTriangles(geo, keep) : geo;
}

/** The triangles dropHiddenFaces keeps, in order, or null when it keeps them all. */
export function visibleTriangles(geo: THREE.BufferGeometry, eps = 1e-4): number[] | null {
  if (geo.index) return null;
  const pos = geo.attributes.position.array as ArrayLike<number>;
  const tris = pos.length / 9;
  // Weld vertices by position, then group triangles that share a welded vertex into parts.
  const ids = new Map<string, number>();
  const vid = new Int32Array(tris * 3);
  for (let v = 0; v < tris * 3; v++) {
    const key = `${Math.round(pos[v * 3] / eps)},${Math.round(pos[v * 3 + 1] / eps)},${Math.round(pos[v * 3 + 2] / eps)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    vid[v] = id;
  }
  const root = Array.from({ length: ids.size }, (_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let t = 0; t < tris; t++) {
    root[find(vid[t * 3 + 1])] = find(vid[t * 3]);
    root[find(vid[t * 3 + 2])] = find(vid[t * 3]);
  }
  const parts = new Map<number, number[]>();
  for (let t = 0; t < tris; t++) {
    const r = find(vid[t * 3]);
    (parts.get(r) ?? parts.set(r, []).get(r)!).push(t);
  }
  if (parts.size < 2) return null;
  const p = (v: number) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  // A closed convex part as its face planes (unit normal n, offset d: inside where n·x <= d).
  interface Solid { planes: number[][]; tris: Set<number>; min: number[]; max: number[] }
  const solids: Solid[] = [];
  for (const list of parts.values()) {
    const edges = new Map<string, number>();
    for (const t of list) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const u = vid[t * 3 + a], w = vid[t * 3 + b];
        const k = u < w ? `${u}-${w}` : `${w}-${u}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    if ([...edges.values()].some((n) => n !== 2)) continue; // open: a plate, a panel
    const planes: number[][] = [];
    for (const t of list) {
      const [a, b, c] = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) continue; // degenerate (a cone's tip)
      const u = [n[0] / l, n[1] / l, n[2] / l, 0];
      u[3] = u[0] * a[0] + u[1] * a[1] + u[2] * a[2];
      if (!planes.some((q) => Math.abs(q[0] - u[0]) + Math.abs(q[1] - u[1]) + Math.abs(q[2] - u[2]) + Math.abs(q[3] - u[3]) < eps)) planes.push(u);
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let convex = true;
    for (const t of list) {
      for (let k = 0; k < 3; k++) {
        const x = p(t * 3 + k);
        for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], x[i])), (max[i] = Math.max(max[i], x[i]));
        if (planes.some((q) => q[0] * x[0] + q[1] * x[1] + q[2] * x[2] - q[3] > eps)) convex = false;
      }
    }
    if (convex) solids.push({ planes, tris: new Set(list), min, max });
  }
  if (!solids.length) return null;
  const inside = (s: Solid, x: number[]) =>
    x.every((v, i) => v >= s.min[i] - eps && v <= s.max[i] + eps) && s.planes.every((q) => q[0] * x[0] + q[1] * x[1] + q[2] * x[2] - q[3] <= eps);
  // A face flush with a solid's face and facing the same way is kept: the solid's own face there
  // might be dropped in turn (two parts sharing an outer face), which would leave a hole.
  const flushOut = (s: Solid, corners: number[][], n: number[]) =>
    s.planes.some((q) => q[0] * n[0] + q[1] * n[1] + q[2] * n[2] > 0.99 && corners.every((x) => Math.abs(q[0] * x[0] + q[1] * x[1] + q[2] * x[2] - q[3]) <= eps));
  const keep: number[] = [];
  for (let t = 0; t < tris; t++) {
    const corners = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
    const [a, b, c] = corners;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let i = 0; i < 3; i++) n[i] /= l;
    if (!solids.some((s) => !s.tris.has(t) && corners.every((x) => inside(s, x)) && !flushOut(s, corners, n))) keep.push(t);
  }
  return keep.length === tris ? null : keep;
}

/** A non-indexed geometry with only these triangles. */
export function keepTriangles(geo: THREE.BufferGeometry, keep: readonly number[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize, src = attr.array as ArrayLike<number>;
    const arr = new Float32Array(keep.length * 3 * size);
    keep.forEach((t, i) => {
      for (let j = 0; j < 3 * size; j++) arr[i * 3 * size + j] = src[t * 3 * size + j];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
