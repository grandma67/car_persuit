import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sceneBreakdown, staleMatrices } from './sceneAudit';

const box = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
const frozen = (o: THREE.Object3D) => (o.updateMatrix(), (o.matrixAutoUpdate = false), o);

describe('scene audit', () => {
  it('breaks the scene down by owner tag, then by the names given, then by type', () => {
    const scene = new THREE.Scene();
    const city = new THREE.Group();
    city.userData.owner = 'city';
    city.add(box(), box());
    const car = new THREE.Group().add(frozen(box()));
    const lamp = new THREE.PointLight();
    const off = new THREE.SpotLight();
    off.visible = false;
    scene.add(city, car, lamp, off, new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3));
    const b = sceneBreakdown(scene, new Map([[car, 'traffic']]));
    const row = (owner: string) => b.rows.find((r) => r.owner === owner)!;
    expect(row('city')).toMatchObject({ roots: 1, objects: 3, auto: 3, meshes: 2 });
    expect(row('traffic')).toMatchObject({ objects: 2, auto: 1, meshes: 1 });
    expect(row('Mesh')).toMatchObject({ instanced: 1, meshes: 1 });
    expect(b.total.objects).toBe(3 + 2 + 1 + 1 + 1);
    expect(b.lights).toEqual({ PointLight: 1 }); // a hidden light leaves the shader loop
  });

  it('finds frozen objects moved without updateMatrix', () => {
    const scene = new THREE.Scene();
    const part = frozen(box());
    const root = new THREE.Group();
    root.userData.owner = 'city';
    root.add(part);
    const fine = frozen(box());
    scene.add(root, fine);
    expect(staleMatrices(scene)).toEqual([]);
    part.position.x = 2;
    part.name = 'kerb';
    fine.rotation.y = 1;
    fine.updateMatrix(); // moved properly
    expect(staleMatrices(scene)).toEqual(['city > Mesh kerb']);
    root.position.y = 5; // automatic: three keeps it current
    expect(staleMatrices(scene)).toEqual(['city > Mesh kerb']);
  });
});
