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

test('new ink samples notify the world with their selected color', () => {
  const trail = new InkTrail(new THREE.Scene(), new THREE.PerspectiveCamera());
  const contacts = [];
  trail.onPaint = (position, radius, color) => contacts.push({ position: position.clone(), radius, color: color.clone() });
  trail.setColor('#00ff00');
  trail.update(0.1, new THREE.Vector3(5, 4, 3), new THREE.Vector3(0, 0, -1), 100, false);
  assert.ok(contacts.length > 0);
  assert.ok(contacts.every(contact => contact.radius > 0 && contact.color.g > contact.color.r));
});

test('teleporting the trail does not paint the space between positions', () => {
  const trail = new InkTrail(new THREE.Scene(), new THREE.PerspectiveCamera());
  const contacts = [];
  trail.onPaint = (position, radius) => { if (radius > 2) contacts.push(position.clone()); };
  const direction = new THREE.Vector3(0, 0, -1);
  trail.update(0.1, new THREE.Vector3(0, 10, 0), direction, 100, false);
  trail.update(0.1, new THREE.Vector3(20, 10, 0), direction, 100, false);
  contacts.length = 0;
  trail.update(0.1, new THREE.Vector3(500, 10, 0), direction, 100, false);
  assert.ok(contacts.length > 0);
  assert.ok(contacts.every(position => position.x > 450));
  trail.update(0.1, new THREE.Vector3(520, 10, 0), direction, 100, false);
  const geometry = trail.mesh.geometry;
  assert.equal(geometry.drawRange.count, 12);
  assert.deepEqual([...geometry.index.array.slice(0, 12)], [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
});

test('the pattern stays attached to surviving ribbon points as older ones expire', () => {
  const trail = new InkTrail(new THREE.Scene(), new THREE.PerspectiveCamera());
  const direction = new THREE.Vector3(0, 0, -1);
  trail.update(.1, new THREE.Vector3(0, 20, 0), direction, 100, false);
  trail.update(1, new THREE.Vector3(15, 20, 0), direction, 100, false);
  trail.update(1, new THREE.Vector3(45, 20, 0), direction, 100, false);
  const uv = trail.mesh.geometry.getAttribute('uv');
  const secondPoint = uv.getY(2);
  const thirdPoint = uv.getY(4);
  assert.ok(secondPoint > uv.getY(0));
  assert.ok(Math.abs(thirdPoint - 3 * secondPoint) < .0001);
  trail.update(13.1, new THREE.Vector3(), direction, 100, false, false);
  assert.equal(uv.getY(0), secondPoint);
  assert.equal(uv.getY(2), thirdPoint);
});

test('settled splashes stop repainting the same position', () => {
  const trail = new InkTrail(new THREE.Scene(), new THREE.PerspectiveCamera());
  const contacts = [];
  trail.onPaint = (position) => contacts.push(position.clone());
  const position = new THREE.Vector3(0, 20, 0), direction = new THREE.Vector3(0, 0, -1);
  trail.update(.1, position, direction, 100, false);
  trail.update(2, position, direction, 100, false, false);
  const settledCount = contacts.length;
  for (let i = 0; i < 30; i++) trail.update(.01, position, direction, 100, false, false);
  assert.equal(contacts.length, settledCount);
});
