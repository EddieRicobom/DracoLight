import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
};
const { City } = await import('../src/city.js');

function makeCity() {
  const city = Object.create(City.prototype);
  city.scene = new THREE.Scene();
  city.grid = new Map([[city.gi(540, 5, 540), 0]]);
  city.alive = new Uint8Array([1]);
  city._buildDebris();
  return city;
}

function advance(city, seconds) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) city._updateDebris(0.05);
}

function stopSpin(city, i) {
  city.dQ.set([0, 0, 0, 1], i * 4);
  city.dW.fill(0, i * 3, i * 3 + 3);
}

test('roof rubble shrinks and expires, keeping the remaining draw slots packed', () => {
  const city = makeCity();
  const mesh = city.dMesh;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const scale = new THREE.Vector3();
  city.spawnDebris(2.5, 34, 2.5, 0, -4, 0, 2, 1, 0, 0);
  stopSpin(city, 0);
  advance(city, 1.5);
  assert.equal(city.dRest[0], 1);
  assert.equal(mesh.count, 1);
  assert.ok(mesh.instanceMatrix.array[13] > 30);

  city.spawnDebris(20, 0.6, 20, 0, 0, 0, 1, 0, 1, 0, true);
  advance(city, 1.6);
  mesh.getMatrixAt(0, matrix);
  scale.setFromMatrixScale(matrix);
  assert.ok(scale.x > 0 && scale.x < 2);
  assert.equal(mesh.count, 2);

  advance(city, 1.5);
  assert.equal(mesh.count, 1);
  assert.equal(mesh.instanceMatrix.array[12], 20);
  mesh.getColorAt(0, color);
  assert.deepEqual(color.toArray(), [0, 1, 0]);

  advance(city, 3);
  assert.equal(mesh.count, 0);
  assert.equal(mesh.visible, false);
  const version = mesh.instanceMatrix.version;
  advance(city, 1);
  assert.equal(mesh.instanceMatrix.version, version);
});

test('destroying a roof wakes resting fragments and falling chunks still damage the city', () => {
  const city = makeCity();
  city.spawnDebris(2.5, 33, 2.5, 0, -2, 0, 2, 1, 1, 1);
  stopSpin(city, 0);
  advance(city, 1.2);
  assert.equal(city.dRest[0], 1);
  const roofHeight = city.dP[1];
  city.alive[0] = 0;
  city.grid.clear();
  advance(city, 0.4);
  assert.equal(city.dRest[0], 0);
  assert.ok(city.dP[1] < roofHeight);

  city.alive[0] = 1;
  city.grid.set(city.gi(540, 5, 540), 0);
  let strikes = 0;
  city.removeChunk = i => {
    assert.equal(i, 0);
    strikes++;
    city.grid.clear();
    return true;
  };
  city.spawnDebris(2.5, 45, 2.5, 0, -20, 0, 4.8, 1, 1, 1, true);
  advance(city, 1);
  assert.equal(strikes, 1);
});

test('a saturated pool preserves structural collapse effects within the instance budget', () => {
  const city = makeCity();
  for (let i = 0; i <= city.dN; i++) city.spawnDebris(20, 3, 20, 0, 0, 0, 1, 1, 1, 1);
  city.spawnDebris(40, 4, 40, 0, 0, 0, 1, 1, 1, 1, true);
  city._updateDebris(0.05);
  assert.equal(city.dMesh.count, city.dN);
  assert.equal(city.dP[0], 40);
  assert.equal(city.dHeavy[0], 1);
});
