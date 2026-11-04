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
