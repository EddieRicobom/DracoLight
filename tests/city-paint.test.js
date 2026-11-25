import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const painted = [];
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      beginPath() {}, arc() {}, fill() { painted.push(true); }, clearRect() {},
    }),
  }),
};
const { City, HALF } = await import('../src/city.js');

test('painting reports only changed chunks and ground contacts', () => {
  const city = Object.create(City.prototype);
  city.grid = new Map();
  city.paintData = new Uint8Array(4);
  city.meshes = [{ paintAttribute: new THREE.InstancedBufferAttribute(new Uint8Array(4), 4, true), paintDirty: [Infinity, -1] }];
  city.chunkPart = new Uint8Array([0]);
  city.chunkLocal = new Uint32Array([0]);
  city.propHash = new Map();
  city.props = [];
  city.propGroups = [];
  city._buildPaint();
  city.grid.set(city.gi(540, 4, 540), 0); // world origin, 20 m above ground

  const center = new THREE.Vector3(2.5, 22.5, 2.5);
  assert.equal(city.paintSphere(new THREE.Vector3(10000, 20, 0), 2, '#ff0000'), 0);
  assert.equal(city.paintSphere(center, 2, '#ff0000'), 1);
  assert.equal(city.paintSphere(center, 2, '#ff0000'), 0);
  assert.equal(city.paintSphere(center, 2, '#0000ff'), 1);
  assert.equal(city.paintSphere(new THREE.Vector3(0, 0, 0), 2, '#00ff00'), 1);
  assert.equal(painted.length, 1);
  assert.equal(city.paintSphere(new THREE.Vector3(HALF + 175, 0, 0), 2, '#00ff00'), 1);
  assert.equal(city.paintSphere(new THREE.Vector3(city.paintHalfExtent + 100, 0, 0), 2, '#00ff00'), 0);
  assert.equal(painted.length, 2);
});

test('prop repaints stay bounded until a hidden batch is uploaded', () => {
  const city = Object.create(City.prototype);
  const attr = new THREE.InstancedBufferAttribute(new Uint8Array(16), 4, true);
  const group = { paintAttrs: [attr] };
  city.grid = new Map();
  city.paintData = new Uint8Array(0);
  city.meshes = [];
  city.propHash = new Map();
  city.props = [];
  city.propGroups = [group];
  city._buildPaint();
  city._addProp(2, group, 2, 0, 0, 1, null);
  city._addProp(2, group, 0, 20, 0, 1, null);
  const car = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 1000; i++) {
    assert.equal(city.paintSphere(car, 1, i % 2 ? '#ff0000' : '#0000ff'), 1);
  }
  assert.equal(attr.updateRanges.length, 1);
  assert.deepEqual(attr.updateRanges[0], { start: 8, count: 4 });
  assert.equal(city.paintSphere(new THREE.Vector3(20, 1, 0), 1, '#0000ff'), 1);
  assert.deepEqual(attr.updateRanges, [{ start: 0, count: 12 }]);

  // The next render must upload the cleared car as well as the repainted one.
  city.clearPaint();
  assert.equal(city.paintSphere(car, 1, '#ff0000'), 1);
  assert.deepEqual(attr.updateRanges, [{ start: 0, count: attr.array.length }]);
  assert.deepEqual([...attr.array.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...attr.array.slice(8, 12)], [255, 0, 0, 255]);
});

test('ground texture batches paint uploads and clear uploads immediately', () => {
  const city = Object.create(City.prototype);
  city.grid = new Map();
  city.paintData = new Uint8Array(0);
  city.meshes = [];
  city.propHash = new Map();
  city.props = [];
  city.propGroups = [];
  city._buildPaint();
  city._streamDistricts = () => {};
  city._updateDebris = () => {};
  city._dirtyB = new Set();
  city._collapseT = 0;
  const version = city.paintTexture.version;
  city.paintSphere(new THREE.Vector3(0, 0, 0), 2, '#ff0000');
  city.update(.01, null);
  assert.equal(city.paintTexture.version, version + 1);
  city.paintSphere(new THREE.Vector3(10, 0, 0), 2, '#ff0000');
  city.update(.01, null);
  assert.equal(city.paintTexture.version, version + 1);
  city.update(.15, null);
  assert.equal(city.paintTexture.version, version + 2);
  const propPaint = new THREE.InstancedBufferAttribute(new Uint8Array([255, 0, 0, 255]), 4, true);
  propPaint.addUpdateRange(0, 4);
  city.propGroups.push({ paintAttrs: [propPaint] });
  city.clearPaint();
  assert.equal(city.paintTexture.version, version + 3);
  assert.deepEqual([...propPaint.array], [0, 0, 0, 0]);
  assert.deepEqual(propPaint.updateRanges, [{ start: 0, count: propPaint.array.length }]);
});
