import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }),
};
const { City } = await import('../src/city.js');

test('solar bake finds an upstream blocker and rechecks its shadow after destruction', () => {
  const city = Object.create(City.prototype);
  city.cx = new Int16Array([540, 539]);
  city.cy = new Int16Array([0, 2]);
  city.cz = new Int16Array([540, 541]);
  city.grid = new Map([[city.gi(540, 0, 540), 0], [city.gi(539, 2, 541), 1]]);
  city.sunData = new Uint8Array(6);
  city.sunBaked = new Uint8Array(2);
  city.sunPending = new Set();
  city.sunShadowPending = new Set();
  city.chunkPart = new Uint8Array(2);
  city.meshes = [{ mesh: {} }];

  city._bakeSun(0);
  assert.equal(city.sunData[0], 0, 'roof starts in shadow');
  city.grid.delete(city.gi(539, 2, 541));
  city._invalidateSunShadow(1);
  assert.ok(city.sunShadowPending.has(1), 'destruction queues shadow work');
  city._traceSunShadow(1);
  assert.equal(city.sunBaked[0], 0, 'downstream chunk is queued for rebake');
  assert.ok(city.sunPending.has(0));
  city._bakeSun(0);
  assert.equal(city.sunData[0], 255, 'roof becomes sunlit after blocker removal');
});

test('reset clears stale solar work and restores the ground and streamed face bake', () => {
  const city = Object.create(City.prototype);
  city.clearPaint = () => {};
  city._buildScorch();
  let groundBakes = 0;
  city._bakeGroundSun = () => { groundBakes++; };
  city.grid = new Map();
  city.cx = new Int16Array([540]); city.cy = new Int16Array([0]); city.cz = new Int16Array([540]);
  city.cb = new Int32Array([0]); city.alive = new Uint8Array([0]); city.hp = new Float32Array([0]);
  city.lots = [{ style: 0 }]; city.buildings = [{ alive: 0, cells: [0] }];
  city.sunBaked = new Uint8Array([1]); city.sunData = new Uint8Array([0, 0, 0]);
  city.sunPending = new Set([99]); city.sunShadowPending = new Set([88]);
  city.groundSunDirty = true; city.groundSunTimer = 1;
  city._dirtyB = new Set(); city._refreshProxy = () => {};
  city.burnAttr = { array: new Float32Array(1) };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const sun = new THREE.InstancedBufferAttribute(new Uint8Array(3), 3, true);
  geometry.setAttribute('aSun', sun);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
  city.meshes = [{ ids: [0], mesh, burnAttribute: new THREE.InstancedBufferAttribute(new Float32Array(1), 1) }];
  city.props = []; city.propMeshes = []; city.propInitialMatrices = [];
  city.dState = new Uint8Array(1); city.dRest = new Int32Array(1); city.dMesh = { count: 1 };

  city.reset();
  assert.equal(groundBakes, 1);
  assert.equal(city.buildings[0].alive, 1);
  assert.deepEqual([...city.sunPending], [0]);
  assert.equal(city.sunShadowPending.size, 0);
  assert.equal(city.sunBaked[0], 0);
  assert.deepEqual([...sun.array], [255, 255, 255]);
});
