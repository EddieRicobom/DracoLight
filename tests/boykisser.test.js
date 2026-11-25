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
  const eyes = gltf.scene.getObjectByName('LeftEye_024').getWorldPosition(new THREE.Vector3());
  const tail = gltf.scene.getObjectByName('TailRoot_03').getWorldPosition(new THREE.Vector3());
  assert.ok(eyes.z > tail.z, 'the supplied model faces local +Z');
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

test('can jump on the first frame after teleporting to a clear street', () => {
  const player = new Boykisser(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(0, 40, 0), { ground: true });
  assert.equal(player.update(0.05, { jump: true, sweep: true }), 'air');
  assert.ok(player.position.y > 0);
  player.dispose();
});

test('half stick input gives half speed and movement facing leaves the camera yaw intact', () => {
  const player = new Boykisser(new THREE.Scene(), testCity());
  const start = new THREE.Vector3(-20, 0, 20);
  player.teleport(start, { ground: true, yaw: 0 });
  player.update(0.05, { strafe: 0.5, yaw: 0, faceMovement: true });
  assert.ok(Math.abs(start.x - player.position.x - player.walkSpeed * 0.05 / 2) < 0.001);
  assert.equal(player.yaw, 0);
  assert.ok(player.facingYaw < -0.9);
  assert.equal(player.root.rotation.y, player.facingYaw);
  player.teleport(start, { yaw: 1 });
  assert.equal(player.facingYaw, 1);
  player.dispose();
});

test('swept movement catches a thin barrier at high speed and lets a leap clear the roof edge', () => {
  const city = testCity();
  const player = new Boykisser(new THREE.Scene(), city);
  const yaw = Math.PI / 2;
  player.teleport(new THREE.Vector3(4, 9.1, 0), { yaw });
  player.update(0.05, { forward: 1, sprint: true, lift: 42, allowClimb: false, sweep: true });
  assert.ok(player.position.x > 5 && player.position.y > 10);

  city.chunkAt = (x, y) => x >= 2 && x <= 2.5 && y < 10 ? 1 : -1;
  player.teleport(new THREE.Vector3(), { yaw });
  player.update(0.05, { forward: 1, sprint: true, speedScale: 3, allowClimb: false, sweep: true });
  assert.ok(player.position.x < 2);
  player.dispose();
});

test('swept movement lands on the higher roof edge and falls after clearing it', () => {
  const city = testCity();
  const raycast = city.raycast;
  let rayCount = 0;
  city.raycast = (origin, direction, maxDistance) => {
    rayCount++;
    if (origin.x >= 3 && origin.x < 5 && origin.y >= 5) {
      const lowerRoofDistance = origin.y - 5;
      if (lowerRoofDistance <= maxDistance) return lowerRoofDistance;
    }
    return raycast(origin, direction, maxDistance);
  };
  const player = new Boykisser(new THREE.Scene(), city);
  const yaw = -Math.PI / 2;
  player.teleport(new THREE.Vector3(0, 0, 0), { ground: true, yaw });
  player.update(0.05, { sweep: true });
  assert.equal(rayCount, 1);

  player.teleport(new THREE.Vector3(4.6, 12, 0), { yaw });
  player.update(0.05, { sweep: true, lift: -100 });
  assert.ok(Math.abs(player.position.y - 10) < 0.001);
  assert.equal(player.grounded, true);

  player.update(0.05, { forward: 1, sweep: true });
  assert.ok(player.position.y < 10);
  assert.equal(player.grounded, false);
  player.dispose();
});

test('forward and strafe follow the chase camera at different headings', () => {
  const player = new Boykisser(new THREE.Scene(), testCity());
  const camera = new THREE.PerspectiveCamera();
  const start = new THREE.Vector3(-20, 0, 20);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    camera.position.copy(start).addScaledVector(forward, -12).add(new THREE.Vector3(0, 5, 0));
    camera.lookAt(start.clone().addScaledVector(forward, 5).add(new THREE.Vector3(0, 2.5, 0)));
    camera.updateMatrixWorld();
    const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    screenRight.y = 0;
    screenRight.normalize();
    for (const [input, expected] of [
      [{ forward: 1 }, forward],
      [{ forward: -1 }, forward.clone().negate()],
      [{ strafe: 1 }, screenRight],
      [{ strafe: -1 }, screenRight.clone().negate()],
    ]) {
      player.teleport(start, { ground: true, yaw });
      player.update(0.05, { ...input, yaw });
      const delta = player.position.clone().sub(start).setY(0).normalize();
      assert.ok(delta.dot(expected) > 0.999, `${JSON.stringify(input)} at yaw ${yaw} should match camera direction`);
    }
  }
  player.dispose();
});
