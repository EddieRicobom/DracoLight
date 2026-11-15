import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InkTrail } from '../src/ink.js';

test('ink fades and expires after fifteen seconds, preserving new colors', () => {
  const trail = new InkTrail(new THREE.Scene(), new THREE.PerspectiveCamera());
  const direction = new THREE.Vector3(0, 0, -1);
  trail.setColor('#ff0000');
  trail.update(0.01, new THREE.Vector3(0, 20, 0), direction, 100, false);
  const original = trail.points[0];
  trail.setColor('#0000ff');
  trail.update(13, new THREE.Vector3(0, 20, -20), direction, 100, false);
  assert.ok(trail.alpha[0] < .68 && trail.alpha[0] > 0);
  assert.ok(original.color.r > original.color.b);
  assert.ok(trail.points.at(-1).color.b > trail.points.at(-1).color.r);
  trail.update(2.1, new THREE.Vector3(0, 20, -40), direction, 100, false);
  assert.ok(!trail.points.includes(original));
  assert.ok(trail.splashes.every(s => trail.clock - s.born < 15));
  trail.clear();
  assert.equal(trail.points.length, 0);
  assert.equal(trail.splashes.length, 0);
});
