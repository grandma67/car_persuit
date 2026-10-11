import * as THREE from 'three';

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
