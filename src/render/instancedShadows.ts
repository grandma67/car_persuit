import * as THREE from 'three';

/**
 * three draws every shadow caster with one shared depth material, so with instanced and plain casters
 * in the scene the shadow pass switches its program variant (instancing, instance colours) at nearly
 * every draw: a program lookup each time, ~30 a frame of garbage. Instanced casters under `root` get
 * depth materials of their own instead, one per variant, so each variant keeps its program.
 * Casters three gives a per-material depth copy (alpha-tested maps, displacement, clipping) or that
 * have their own already keep theirs. The materials are freed with the scene (`disposeScene`).
 */
export function separateInstancedShadows(root: THREE.Object3D): void {
  let plain: THREE.MeshDepthMaterial | null = null;
  let coloured: THREE.MeshDepthMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.castShadow || mesh.customDepthMaterial || needsOwnDepth(mesh.material)) return;
    mesh.customDepthMaterial = mesh.instanceColor ? (coloured ??= new THREE.MeshDepthMaterial()) : (plain ??= new THREE.MeshDepthMaterial());
  });
}

/** Whether three draws this material's shadow with a depth copy of its own (WebGLShadowMap.getDepthMaterial). */
export function needsOwnDepth(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material)) return material.some(needsOwnDepth);
  const m = material as THREE.MeshStandardMaterial;
  return (
    !!m.clippingPlanes?.length ||
    (!!m.displacementMap && m.displacementScale !== 0) ||
    ((!!m.alphaMap || !!m.map) && m.alphaTest > 0) ||
    m.alphaToCoverage
  );
}
