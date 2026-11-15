import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FX } from '../src/fx.js';

test('speed effects cover Mach 3 through 7 and reset when flight stops', () => {
  const fx = new FX(new THREE.Scene(), new THREE.PerspectiveCamera());
  const geometry = fx.speedStreaks.geometry;
  const tiers = new Set(geometry.getAttribute('aTier').array);
  assert.deepEqual([...tiers].sort(), [0, 1, 2, 3, 4, 5]);
  const position = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, -1);
  for (const mach of [3, 4, 5, 6, 7]) {
    for (let frame = 0; frame < 80; frame++) fx.updateSpeed(.05, position, direction, mach * 343);
    assert.ok(Math.abs(fx.speedStreaks.material.uniforms.uMach.value - mach) < .05);
  }
  fx.updateSpeed(0, position, direction, 0, false);
  assert.equal(fx.speedStreaks.material.uniforms.uMach.value, 0);
  assert.equal(fx.speedStreaks.visible, false);
});
