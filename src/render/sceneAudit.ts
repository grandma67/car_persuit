// What the scene is made of and what three does with it each frame (dbg.sceneBreakdown), and the
// matrices someone forgot to update (dbg.staleMatrices). Pure functions over the scene graph, so
// tests can run them without a renderer.
import * as THREE from 'three';

export interface BreakdownRow {
  owner: string;
  /** Top-level objects, and objects in all. */
  roots: number;
  objects: number;
  /** Objects three recomposes every frame (matrixAutoUpdate): the cost of updateMatrixWorld. */
  auto: number;
  meshes: number;
  instanced: number;
  shadowCasters: number;
}

export interface Breakdown {
  rows: BreakdownRow[];
  total: Omit<BreakdownRow, 'owner'>;
  /** Visible lights by type: each is a loop iteration in every lit pixel (intensity 0 included). */
  lights: Record<string, number>;
}

/**
 * The scene by owner: a top-level object's `userData.owner` (Game.owned tags each builder's), else
 * the name `owners` gives its root (the player's, cops' and civilians' cars), else its type.
 */
export function sceneBreakdown(scene: THREE.Object3D, owners: Map<THREE.Object3D, string> = new Map()): Breakdown {
  const rows = new Map<string, BreakdownRow>();
  const lights: Record<string, number> = {};
  for (const root of scene.children) {
    const owner = (root.userData.owner as string | undefined) ?? owners.get(root) ?? root.type;
    const row = rows.get(owner) ?? { owner, roots: 0, objects: 0, auto: 0, meshes: 0, instanced: 0, shadowCasters: 0 };
    rows.set(owner, row);
    row.roots++;
    root.traverse((o) => {
      row.objects++;
      if (o.matrixAutoUpdate) row.auto++;
      if ((o as THREE.Mesh).isMesh) row.meshes++;
      if ((o as THREE.InstancedMesh).isInstancedMesh) row.instanced++;
      if (o.castShadow && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints)) row.shadowCasters++;
    });
    root.traverseVisible((o) => {
      if ((o as THREE.Light).isLight) lights[o.type] = (lights[o.type] ?? 0) + 1;
    });
  }
  const sorted = [...rows.values()].sort((a, b) => b.objects - a.objects);
  const total = { roots: 0, objects: 0, auto: 0, meshes: 0, instanced: 0, shadowCasters: 0 };
  for (const r of sorted) for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r[k];
  return { rows: sorted, total, lights };
}

const composed = new THREE.Matrix4();

/**
 * Objects whose matrix three no longer updates (matrixAutoUpdate off: the city, props, car parts,
 * a held car) but whose position, rotation or scale has moved since: drawn where they were. Each as
 * `owner > type name`. Expected `[]`; whatever moves such an object must call updateMatrix().
 */
export function staleMatrices(scene: THREE.Object3D, owners: Map<THREE.Object3D, string> = new Map(), limit = 20): string[] {
  const out: string[] = [];
  for (const root of scene.children) {
    const owner = (root.userData.owner as string | undefined) ?? owners.get(root) ?? root.type;
    root.traverse((o) => {
      if (o.matrixAutoUpdate || out.length >= limit) return;
      composed.compose(o.position, o.quaternion, o.scale);
      const a = composed.elements;
      const b = o.matrix.elements;
      for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-4 * Math.max(1, Math.abs(a[i]))) {
          out.push(`${owner} > ${o.type}${o.name ? ` ${o.name}` : ''}`);
          return;
        }
      }
    });
  }
  return out;
}
