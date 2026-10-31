import * as THREE from 'three';
import { needsOwnDepth } from './instancedShadows';

/**
 * Materials drawn by meshes of more than one kind under `root`: plain, instanced, and instanced with
 * per-instance colours. three keys programs on `instancing` and `instancingColor`, so such a material
 * rebuilds its program parameters and cache key at every switch, every frame (a third of the per-frame
 * garbage once). Give each kind its own `.clone()`, or every instanced user an `instanceColor`.
 * The shadow pass counts too: casters without a `customDepthMaterial` share three's own depth material
 * (`separateInstancedShadows` keeps instanced casters off it).
 * The expected list is empty; `dbg.mixedMaterials()` and the perf/restart evals check it.
 */
export function mixedMaterials(root: THREE.Object3D): string[] {
  const SHADOW = 'three shadow depth';
  const users = new Map<THREE.Material | string, Map<string, string[]>>();
  const note = (m: THREE.Material | string, kind: string, name: string) => {
    let u = users.get(m);
    if (!u) users.set(m, (u = new Map()));
    let names = u.get(kind);
    if (!names) u.set(kind, (names = []));
    names.push(name);
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const inst = o as THREE.InstancedMesh;
    const kind = !inst.isInstancedMesh ? 'plain' : inst.instanceColor ? 'instanced+colour' : 'instanced';
    const name = o.name || o.parent?.name || o.type;
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) note(m, kind, name);
    if (mesh.castShadow && !(o as THREE.Points).isPoints) {
      if (mesh.customDepthMaterial) note(mesh.customDepthMaterial, kind, name);
      else if (!needsOwnDepth(mesh.material)) note(SHADOW, kind, name);
    }
  });
  const out: string[] = [];
  for (const [m, u] of users) {
    if (u.size < 2) continue;
    const label = typeof m === 'string' ? m : `${m.type} ${m.uuid.slice(0, 8)}`;
    out.push(`${label} ${[...u].map(([kind, names]) => `${kind}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`).join(' | ')}`);
  }
  return out;
}
