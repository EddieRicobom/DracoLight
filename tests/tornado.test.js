import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PaintTornado, SpiralDetector } from '../src/tornado.js';

test('formation progress follows the turn, clears when straightened and completes on emission', () => {
  const detector = new SpiralDetector();
  const dt = 1 / 60, radius = 80;
  function updateCircle(angle) {
    return detector.update(dt, { x: radius * Math.cos(angle), y: 100, z: radius * Math.sin(angle) },
      { x: -Math.sin(angle), z: Math.cos(angle) }, radius * 1.2);
  }

  assert.equal(detector.formationProgress, 0);
  for (let i = 0; i <= 90; i++) assert.equal(updateCircle(i * 0.02), null);
  assert.ok(detector.formationProgress > 0.3 && detector.formationProgress < 0.35);
  for (let i = 0; i < 20; i++) {
    const distance = (i + 1) * radius * 0.02;
    detector.update(dt, { x: radius * Math.cos(1.8) - distance * Math.sin(1.8),
      z: radius * Math.sin(1.8) + distance * Math.cos(1.8) },
    { x: -Math.sin(1.8), z: Math.cos(1.8) }, radius * 1.2);
  }
  assert.equal(detector.formationProgress, 0);

  detector.reset();
  let spiral;
  for (let i = 0; i < 320 && !spiral; i++) {
    assert.ok(detector.formationProgress < 1);
    spiral = updateCircle(-i * 0.02);
  }
  assert.ok(spiral);
  assert.equal(detector.formationProgress, 0);
  assert.ok(detector.emittedAt > 0);
});

test('spiral makes one growing tornado, straight flight does not, and clear removes it', () => {
  const scene = new THREE.Scene();
  const effect = new PaintTornado(scene);
  let painted = 0;
  effect.onPaint = (position, radius, color) => {
    assert.ok(Number.isFinite(position.x) && radius > 0 && color.isColor);
    painted++;
  };
  const radius = 90, dt = 1 / 30, angularSpeed = 0.8;
  for (let i = 0; i < 1500; i++) {
    const a = i * dt * angularSpeed;
    effect.update(dt, new THREE.Vector3(radius * Math.cos(a), 100, radius * Math.sin(a)),
      new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), radius * angularSpeed, '#22aaff');
  }
  assert.equal(effect.vortices.length, 1);
  assert.ok(painted > 0);
  assert.ok(effect.vortices[0].group.scale.x > 1);
  assert.equal(effect.vortices[0].group.children.filter((child) => child.isMesh).length, 4);
  assert.equal(effect.vortices[0].group.children.filter((child) => child.isPoints).length, 1);
  assert.ok(effect.vortices[0].life - effect.vortices[0].age >= 20);
  effect.clear();
  assert.equal(scene.children.length, 0);
  const detector = new SpiralDetector();
  for (let i = 0; i < 300; i++) {
    assert.equal(detector.update(dt, { x: i * 2, z: 0 }, { x: 1, z: 0 }, 60), null);
  }
});

test('paint ribbons widen upward and faster flight makes the tornado spin faster', () => {
  const scene = new THREE.Scene();
  const effect = new PaintTornado(scene);
  const spiral = { x: 0, y: 100, z: 0, radius: 90, duration: 8, direction: 1, generation: 1, flightSpeed: 60 };
  effect.spawn(spiral, '#22aaff');
  const slow = effect.vortices[0];
  const ribbon = slow.group.children[0].geometry.getAttribute('position');
  const bottomRadius = Math.hypot(ribbon.getX(0), ribbon.getZ(0));
  const topRadius = Math.hypot(ribbon.getX(ribbon.count - 1), ribbon.getZ(ribbon.count - 1));
  assert.ok(topRadius > bottomRadius * 5);
  assert.equal(slow.group.children[4].geometry.getAttribute('position').count, 160);
  effect.update(0.1, null, null, 0);
  const slowTurn = slow.group.rotation.y;
  effect.spawn({ ...spiral, generation: 2, flightSpeed: 120 }, '#22aaff');
  const fast = effect.vortices[1];
  effect.update(0.1, null, null, 0);
  assert.ok(fast.group.rotation.y > slowTurn);
  assert.equal(fast.group.rotation.y, slowTurn * 2);
  effect.clear();
  assert.equal(scene.children.length, 0);
});

test('fast shots cross a tornado continuously and successive shots steer its drift', () => {
  const effect = new PaintTornado(new THREE.Scene());
  effect.spawn({ x: 0, y: 100, z: 0, radius: 60, duration: 3,
    direction: 1, generation: 1, flightSpeed: 60 });
  const vortex = effect.vortices[0];
  const shot = (x, z) => ({ forward: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(), radius: 16, state: 'waiting', hitVortices: new Set() });
  assert.equal(effect.hitByPaintBall(shot(1, 0),
    new THREE.Vector3(-300, 100, 0), new THREE.Vector3(300, 100, 0)), true);
  assert.ok(vortex.drift.x > 0);
  const startX = vortex.group.position.x;
  effect.update(1, null, null, 0);
  assert.ok(vortex.group.position.x > startX + 50);
  assert.ok(vortex.drift.x > 35, 'the vortex retains momentum after a second');
  assert.equal(effect.hitByPaintBall(shot(0, -1),
    new THREE.Vector3(vortex.group.position.x, 100, 300),
    new THREE.Vector3(vortex.group.position.x, 100, -300)), true);
  assert.ok(vortex.drift.y < 0, 'another shot redirects it');
  effect.clear();
});

test('a moving tornado detects a stationary paint ball along its swept path', () => {
  const effect = new PaintTornado(new THREE.Scene());
  effect.spawn({ x: 0, y: 100, z: 0, radius: 60, duration: 3,
    direction: 1, generation: 1, flightSpeed: 60 });
  const vortex = effect.vortices[0];
  vortex.drift.set(150, 0);
  effect.update(1, null, null, 0);
  const ball = { forward: new THREE.Vector3(1, 0, 0), velocity: new THREE.Vector3(),
    radius: 16, state: 'waiting', hitVortices: new Set() };
  const position = new THREE.Vector3(75, 100, 0);
  assert.equal(effect.hitByPaintBall(ball, position, position), true);
  effect.clear();
});
