import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rng } from './util.js';

// Lightweight Poly Haven cabinets decorate roof chunks without entering the
// city's damage grid. One InstancedMesh per model keeps their draw cost fixed.
const MODELS = ['utility_box_01', 'utility_box_02'];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function disposeAsset(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    for (const material of [object.material].flat()) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

export function createPolyProps(scene, city) {
  const random = rng(67341);
  const placements = [[], []];
  const meshes = [];
  let disposed = false;
  let elapsed = 0;
  let count = 0;

  // Interleave locations across the whole map instead of filling the first district.
  const candidates = city.lots.filter(lot => lot.h >= 7);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const lot of candidates) {
    if (count >= 48) break;
    const side = random() < 0.5 ? -1 : 1;
    const x = lot.x + lot.w / 2 + side * Math.min(2.5, lot.w / 8);
    const z = lot.z + lot.d / 2 + (random() < 0.5 ? -2.5 : 2.5);
    const support = city.chunkAt(x, lot.h * 5 - 2.5, z);
    if (support < 0 || !city.alive[support]) continue;
    const kind = count % MODELS.length;
    placements[kind].push({ x, y: lot.h * 5 + 0.04, z, rotation: random() * Math.PI * 2, support, visible: true });
    count++;
  }

  const loader = new GLTFLoader();
  const ready = Promise.allSettled(MODELS.map(async (id, kind) => {
    if (!placements[kind].length) return;
    const url = `${import.meta.env.BASE_URL}polyhaven/${id}/${id}.gltf`;
    const gltf = await loader.loadAsync(url);
    if (disposed) { disposeAsset(gltf.scene); return; }
    const source = gltf.scene.getObjectByProperty('isMesh', true);
    if (!source) { disposeAsset(gltf.scene); return; }
    const items = placements[kind];
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, items.length);
    mesh.name = `Poly Haven ${id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(2.1, 2.1, 2.1);
    const axis = new THREE.Vector3(0, 1, 0);
    items.forEach((item, index) => {
      item.visible = !!city.alive[item.support];
      if (item.visible) {
        quaternion.setFromAxisAngle(axis, item.rotation);
        matrix.compose(position.set(item.x, item.y, item.z), quaternion, scale);
      } else matrix.copy(ZERO);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    meshes.push({ mesh, items });
  })).then((results) => {
    for (const result of results) if (result.status === 'rejected') console.warn('Poly Haven roof prop failed to load:', result.reason);
    return meshes.length;
  });

  function sync() {
    for (const { mesh, items } of meshes) {
      let changed = false;
      const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3(), scale = new THREE.Vector3(2.1, 2.1, 2.1);
      const axis = new THREE.Vector3(0, 1, 0);
      items.forEach((item, index) => {
        const visible = !!city.alive[item.support];
        if (item.visible === visible) return;
        item.visible = visible;
        if (visible) {
          quaternion.setFromAxisAngle(axis, item.rotation);
          matrix.compose(position.set(item.x, item.y, item.z), quaternion, scale);
          mesh.setMatrixAt(index, matrix);
        } else mesh.setMatrixAt(index, ZERO);
        changed = true;
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    ready,
    update(dt) {
      if (disposed || (elapsed += dt) < 0.2) return;
      elapsed = 0;
      sync();
    },
    reset() { elapsed = 0; if (!disposed) sync(); },
    dispose() {
      disposed = true;
      for (const { mesh } of meshes) {
        scene.remove(mesh);
        disposeAsset(mesh);
      }
      meshes.length = 0;
    },
  };
}
