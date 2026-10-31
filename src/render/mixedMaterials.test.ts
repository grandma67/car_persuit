import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mixedMaterials } from './mixedMaterials';
import { separateInstancedShadows } from './instancedShadows';

describe('mixedMaterials', () => {
  const geo = new THREE.BoxGeometry();
  it('lists a material drawn by an instanced and a plain mesh', () => {
    const shared = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, shared), new THREE.InstancedMesh(geo, shared, 2));
    expect(mixedMaterials(root)).toHaveLength(1);
  });
  it('lists instanced meshes with and without instance colours', () => {
    const shared = new THREE.MeshStandardMaterial();
    const coloured = new THREE.InstancedMesh(geo, shared, 2);
    coloured.setColorAt(0, new THREE.Color(1, 0, 0));
    const root = new THREE.Group();
    root.add(coloured, new THREE.InstancedMesh(geo, shared, 2));
    expect(mixedMaterials(root)).toHaveLength(1);
  });
  it("lists instanced and plain shadow casters on three's shared depth material, until separated", () => {
    const root = new THREE.Group();
    const plain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 2);
    plain.castShadow = inst.castShadow = true;
    root.add(plain, inst);
    expect(mixedMaterials(root)).toHaveLength(1);
    separateInstancedShadows(root);
    expect(inst.customDepthMaterial).toBeDefined();
    expect(mixedMaterials(root)).toEqual([]);
  });
  it('leaves casters three gives their own depth copy', () => {
    const cutout = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 }), 2);
    cutout.castShadow = true;
    separateInstancedShadows(cutout);
    expect(cutout.customDepthMaterial).toBeUndefined();
  });
  it('passes separate materials and same-kind sharing', () => {
    const plain = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, plain), new THREE.Mesh(geo, plain), new THREE.InstancedMesh(geo, plain.clone(), 2));
    expect(mixedMaterials(root)).toEqual([]);
  });
});
