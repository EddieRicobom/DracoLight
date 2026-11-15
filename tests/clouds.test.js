import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createClouds } from '../src/clouds.js';

const position = new THREE.Vector3();
const matrix = new THREE.Matrix4();
function puffPosition(mesh, index = 0) {
  mesh.getMatrixAt(index, matrix);
  return position.setFromMatrixPosition(matrix).clone();
}

test('clouds share one draw mesh and generate deterministically', () => {
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  const first = createClouds(firstScene, { count: 4, seed: 12 });
  const second = createClouds(secondScene, { count: 4, seed: 12 });
  assert.equal(firstScene.children.length, 1);
  assert.equal(first.mesh.count, 20);
  assert.deepEqual(puffPosition(first.mesh).toArray(), puffPosition(second.mesh).toArray());
  first.dispose();
  second.dispose();
  assert.equal(firstScene.children.length, 0);
});

test('dragon passage pushes nearby cloud puffs and they recover', () => {
  const scene = new THREE.Scene();
  const clouds = createClouds(scene, { count: 1, seed: 7 });
  const original = puffPosition(clouds.mesh);
  const dragon = original.clone().add(new THREE.Vector3(22, 0, 0));
  for (let i = 0; i < 12; i++) clouds.update(1 / 60, dragon);
  const disturbed = puffPosition(clouds.mesh);
  assert.ok(disturbed.x < original.x - 1, 'puff moves away from the dragon');
  for (let i = 0; i < 420; i++) clouds.update(1 / 60, new THREE.Vector3(10000, 10000, 10000));
  assert.ok(puffPosition(clouds.mesh).distanceTo(original) < 0.1, 'puff returns to its original position');
  clouds.dispose();
});

test('fast passage disturbs clouds crossed between frames', () => {
  const clouds = createClouds(new THREE.Scene(), { count: 1, seed: 3 });
  const original = puffPosition(clouds.mesh);
  clouds.update(1 / 60, original.clone().add(new THREE.Vector3(-180, 0, 0)));
  clouds.update(1 / 60, original.clone().add(new THREE.Vector3(180, 0, 0)));
  assert.ok(puffPosition(clouds.mesh).distanceTo(original) > 0.01);
  clouds.dispose();
});

test('inactive mode recovers without biped interaction and clears the flight path', () => {
  const clouds = createClouds(new THREE.Scene(), { count: 1, seed: 11 });
  const original = puffPosition(clouds.mesh);
  for (let i = 0; i < 12; i++) clouds.update(1 / 60, original);
  assert.ok(puffPosition(clouds.mesh).distanceTo(original) > 1);

  for (let i = 0; i < 420; i++) clouds.update(1 / 60, original, false);
  assert.ok(puffPosition(clouds.mesh).distanceTo(original) < 0.1,
    'cloud recovers even while the biped occupies it');

  clouds.update(1 / 60, original.clone().add(new THREE.Vector3(180, 0, 0)), true);
  assert.ok(puffPosition(clouds.mesh).distanceTo(original) < 0.1,
    'resuming flight does not sweep from the old dragon position');
  clouds.dispose();
});
