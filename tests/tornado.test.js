import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PaintTornado, SpiralDetector } from '../src/tornado.js';

test('spiral makes one growing tornado, straight flight does not, and clear removes it', () => {
  const scene = new THREE.Scene();
  const effect = new PaintTornado(scene);
  const radius = 90, dt = 1 / 30, angularSpeed = 0.8;
  for (let i = 0; i < 1500; i++) {
    const a = i * dt * angularSpeed;
    effect.update(dt, new THREE.Vector3(radius * Math.cos(a), 100, radius * Math.sin(a)),
      new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), radius * angularSpeed, '#22aaff');
  }
  assert.equal(effect.vortices.length, 1);
  assert.ok(effect.vortices[0].points.scale.x > 1);
  assert.ok(effect.vortices[0].life - effect.vortices[0].age >= 20);
  effect.clear();
  assert.equal(scene.children.length, 0);
  const detector = new SpiralDetector();
  for (let i = 0; i < 300; i++) {
    assert.equal(detector.update(dt, { x: i * 2, z: 0 }, { x: 1, z: 0 }, 60), null);
  }
});
