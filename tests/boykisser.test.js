import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// City loads browser textures at module evaluation; no image data is needed here.
globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }) };
const { Boykisser } = await import('../src/boykisser.js');

function skinnedBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    for (let i = 0; i < object.geometry.attributes.position.count; i++) {
      point.fromBufferAttribute(object.geometry.attributes.position, i);
      if (object.isSkinnedMesh) object.applyBoneTransform(i, point);
      bounds.expandByPoint(point.applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

function limbAverage(player, group, axis, posed) {
  let sum = 0, count = 0;
  for (const part of player.bakedParts) {
    const values = posed ? part.mesh.geometry.attributes.position.array : part.base;
    for (let i = 0; i < part.groups.length; i++) if (part.groups[i] === group && part.influence[i] > 0.7) {
      sum += values[i * 3 + axis];
      count++;
    }
  }
  return sum / count;
}

function testCity() {
  return {
    chunkAt(x, y, z) {
      return x >= 5 && x < 10 && Math.abs(z) < 5 && y >= 0 && y < 10 ? 1 : -1;
    },
    raycast(origin, direction, maxDistance) {
      assert.equal(direction.y, -1);
      const roof = origin.x >= 5 && origin.x < 10 && Math.abs(origin.z) < 5 && origin.y >= 10;
      const distance = origin.y - (roof ? 10 : 0);
      return distance <= maxDistance ? distance : Infinity;
    },
  };
}

test('GLB body is scaled to character height without the detached bow', async () => {
  const file = await readFile(new URL('../public/models/boykisser.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  const player = new Boykisser(new THREE.Scene(), testCity(), { modelLoader: { loadAsync: async () => gltf } });
  await player.load();
  player.root.updateMatrixWorld(true);
  const body = new THREE.Box3();
  player.model.traverse((object) => {
    if (object.isMesh && object.visible) body.union(new THREE.Box3().setFromObject(object));
  });
  assert.ok(Math.abs(body.getSize(new THREE.Vector3()).y - player.height) < 0.05);
  assert.ok(Math.abs(body.min.y) < 0.05);
  assert.equal(gltf.scene.getObjectByName('Object_140').visible, false);
  assert.equal(gltf.scene.getObjectByName('Object_141').visible, false);
  player.update(1 / 60);
  for (const group of [1, 2]) {
    assert.ok(limbAverage(player, group, 1, true) < limbAverage(player, group, 1, false) - 0.002,
      `arm ${group} should move down from the source T-pose`);
  }
  const legBefore = limbAverage(player, 3, 2, true);
  for (const input of [{}, { forward: 1, sprint: true }, { forward: 1 }]) {
    player.update(1 / 60, input);
    const posed = skinnedBounds(player.root).getSize(new THREE.Vector3());
    assert.ok(posed.y < player.height * 1.5, `deformed body too tall: ${posed.y}`);
    assert.ok(posed.x < player.height * 1.5, `deformed body too wide: ${posed.x}`);
  }
  assert.ok(Math.abs(limbAverage(player, 3, 2, true) - legBefore) > 0.0001,
    'running should swing the legs');
  player.dispose();
});

test('runs on the ground, jumps, and climbs a ten metre wall onto its roof', () => {
  const player = new Boykisser(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(0, 40, 0), { ground: true, yaw: Math.PI / 2 });
  assert.equal(player.position.y, 0);
  player.update(1 / 60);
  assert.equal(player.state, 'idle');
  player.update(1 / 60, { jump: true });
  assert.ok(player.position.y > 0);
  let climbed = false;
  for (let frame = 0; frame < 240 && player.position.x < 7; frame++) {
    player.update(1 / 60, { forward: 1, sprint: true, yaw: Math.PI / 2 });
    climbed ||= player.state === 'climb';
  }
  for (let frame = 0; frame < 30; frame++) player.update(1 / 60);
  assert.equal(climbed, true);
  assert.ok(player.position.x >= 7, `expected to get onto the roof; x=${player.position.x}`);
  assert.ok(player.position.y >= 9.9, `expected to reach roof; y=${player.position.y}`);
  player.dispose();
});

test('diagonal input does not exceed running speed', () => {
  const player = new Boykisser(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(-20, 0, 20), { ground: true, yaw: 0 });
  const before = player.position.clone();
  player.update(0.05, { forward: 1, strafe: 1, sprint: true, yaw: 0 });
  assert.ok(player.position.distanceTo(before) <= player.runSpeed * 0.05 + 0.001);
  player.dispose();
});
