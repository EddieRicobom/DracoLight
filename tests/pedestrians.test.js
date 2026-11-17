import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPedestrians } from '../src/pedestrians.js';

const STEP = 1 / 30;

function setup(blocks = [{ x0: 10, z0: 10 }]) {
  const scene = new THREE.Scene();
  const pedestrians = createPedestrians(scene, blocks);
  const [torso, limbs] = scene.children;
  const camera = { position: new THREE.Vector3(40, 20, 40) };
  const update = (frames = 1, dragon = null) => {
    for (let frame = 0; frame < frames; frame++) pedestrians.update(STEP, camera, dragon);
  };
  const position = (index) => {
    const matrix = new THREE.Matrix4();
    torso.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  };
  update();
  return { pedestrians, torso, limbs, camera, update, position };
}

test('pedestrians stay on the sidewalk in the central pilot area and use two instanced meshes', () => {
  const { torso, limbs, camera, update, position } = setup([{ x0: 10, z0: 10 }, { x0: 190, z0: 10 }]);
  assert.ok(torso.isInstancedMesh && limbs.isInstancedMesh);
  assert.equal(torso.count, 3);
  assert.equal(limbs.count, 12);
  const color = new THREE.Color();
  torso.getColorAt(0, color);
  assert.equal(color.r, color.g);
  assert.equal(color.g, color.b);
  const start = position(0);
  update(30);
  assert.ok(start.distanceTo(position(0)) > 0.7);
  for (let step = 0; step < 30; step++) {
    update(180);
    const { x, z } = position(0);
    const edge = Math.min(x - 10, z - 10, 80 - x, 80 - z);
    assert.ok(edge > 3 && edge < 4, `pedestrian departed the sidewalk at ${x}, ${z}`);
  }
  camera.position.set(0, 500, 0);
  update();
  assert.ok(!torso.visible && !limbs.visible);
  assert.equal(torso.count, 0);
});

test('idle pedestrians flee a low dragon and settle again once it passes', () => {
  const { update, position, pedestrians } = setup();
  const start = position(1);
  const dragon = new THREE.Vector3(start.x, 7, start.z - 6);
  update(18, dragon);
  assert.ok(position(1).z > start.z + 1.5);
  update(140);
  const end = position(1);
  update(30);
  assert.ok(Math.abs(position(1).z - end.z) < 0.03);
  pedestrians.reset();
  update();
  assert.ok(Math.abs(position(1).z - start.z) < 0.001);
});

test('a fast low pass is detected between frames while high passes and teleports are ignored', () => {
  const { update, position } = setup();
  const start = position(1);
  const pass = (height, extent) => {
    update(1, new THREE.Vector3(start.x - extent, height, start.z - 4));
    update(1, new THREE.Vector3(start.x + extent, height, start.z - 4));
    update(20);
  };
  pass(80, 65);
  assert.equal(position(1).z, start.z);
  pass(7, 160);
  assert.equal(position(1).z, start.z);
  pass(7, 65);
  assert.ok(position(1).z > start.z + 1.5);
});
