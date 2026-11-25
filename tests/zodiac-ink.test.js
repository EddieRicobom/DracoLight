import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZODIAC_INK, inkPatternPoints, InkFlow } from '../src/zodiac-ink.js';
import { ZodiacAbilities } from '../src/zodiac-abilities.js';

function actorAt(x = 0, y = 0, z = 0) {
  const actor = {
    position: new THREE.Vector3(x, y, z),
    height: 3.4,
    radius: 0.8,
    runSpeed: 38,
    yaw: 0,
    grounded: true,
    climbing: false,
    velocity: { y: 0 },
    update(dt, motion = {}) {
      actor.lastMotion = motion;
      return 'idle';
    },
  };
  return actor;
}

test('every species has an ink style that produces finite, paintable samples', () => {
  const position = new THREE.Vector3(4, 0.8, -3);
  const direction = new THREE.Vector3(1, 0, 0);
  for (const [id, descriptor] of Object.entries(ZODIAC_INK)) {
    const points = inkPatternPoints(descriptor.style, position, direction, 1);
    assert.ok(points.length > 0, id);
    for (const point of points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), id);
      assert.ok(Number.isFinite(point.r) && point.r > 0, id);
    }
  }
});

test('patterns stay anchored to the position and respect scale', () => {
  const position = new THREE.Vector3(10, 1, 20);
  const direction = new THREE.Vector3(0, 0, 1);
  const small = inkPatternPoints('pool', position, direction, 1);
  const large = inkPatternPoints('pool', position, direction, 2);
  assert.equal(small.length, large.length);
  assert.ok(large.every((point, index) => point.r >= small[index].r * 1.9));
  const center = small[0];
  assert.ok(Math.abs(center.x - position.x) < 1e-9 && Math.abs(center.z - position.z) < 1e-9);
  const spread = Math.max(...small.map(point => Math.hypot(point.x - position.x, point.z - position.z)));
  assert.ok(spread > 3);
  const largerSpread = Math.max(...large.map(point => Math.hypot(point.x - position.x, point.z - position.z)));
  assert.ok(Math.abs(largerSpread - spread * 2) < 1e-9);
});

test('a closed loop over wet ink triggers a surf, but a fresh trail does not', () => {
  const flow = new InkFlow({ spacing: 1, minAge: 1, lifetime: 5, radius: 2.5, cooldown: 1.5 });
  flow.record(new THREE.Vector3(0, 0, 0), 0);
  assert.equal(flow.surf(new THREE.Vector3(0, 0, 0), 0.2), false, 'new ink is still drying');
  flow.record(new THREE.Vector3(10, 0, 0), 1);
  flow.record(new THREE.Vector3(10, 0, 10), 2);
  flow.record(new THREE.Vector3(0, 0, 10), 3);
  assert.equal(flow.surf(new THREE.Vector3(0, 0, 1), 4), true);
  assert.equal(flow.points.length, 0, 'the loop is consumed');
  flow.record(new THREE.Vector3(0, 0, 0), 4.2);
  assert.equal(flow.surf(new THREE.Vector3(0, 0, 0), 4.4), false, 'minAge and cooldown still apply');
  flow.record(new THREE.Vector3(9, 0, 0), 5);
  assert.equal(flow.surf(new THREE.Vector3(0, 0, 0), 5.6), true);
});

test('full ink makes the next ability a longer, wider Obra-prima', () => {
  const events = [];
  const city = { chunkAt: () => -1, raycast: () => Infinity };
  const abilities = new ZodiacAbilities({ city, onEffect: (effect) => events.push(effect) });
  const actor = actorAt();
  abilities.select('tiger');
  abilities.addInk(0.5);
  assert.equal(abilities.surgeReady, false);
  abilities.addInk(0.5);
  assert.equal(abilities.surgeReady, true);
  assert.ok(abilities.activate(actor, 0));
  abilities.update(0.025, actor, { yaw: 0 });
  assert.equal(abilities.surgeActive, true);
  assert.equal(abilities.ink, 0);
  assert.ok(events.some(({ type }) => type === 'surge'));
  assert.ok(actor.lastMotion.lift > 18, 'the surge lifts higher');
  assert.ok(abilities.endsAt - abilities.startedAt > 4.5, 'the surge lasts longer');
});

test('species ink mechanics add springs, wall kicks and wing flaps', () => {
  const city = { chunkAt: () => -1, raycast: () => Infinity };
  const events = [];
  const abilities = new ZodiacAbilities({ city, onEffect: (effect) => events.push(effect) });

  const rabbit = actorAt();
  abilities.select('rabbit');
  abilities.activate(rabbit, 0);
  abilities.update(0.025, rabbit, { yaw: 0 });
  const firstLift = rabbit.lastMotion.lift;
  for (let i = 0; i < 10; i++) abilities.update(0.025, rabbit, { yaw: 0 });
  abilities.activate(rabbit, 0);
  abilities.update(0.025, rabbit, { yaw: 0 });
  assert.ok(rabbit.lastMotion.lift > firstLift, 'the earlier stamp springs the second hop');

  const goat = actorAt();
  goat.grounded = false;
  goat.climbing = true;
  abilities.select('goat');
  abilities.activate(goat, 0);
  abilities.update(0.025, goat, { yaw: 0, jump: true });
  assert.ok(goat.lastMotion.lift >= 27);
  assert.ok(events.some(({ id, type }) => id === 'goat' && type === 'ink'));

  const rooster = actorAt(0, 30, 0);
  rooster.grounded = false;
  abilities.select('rooster');
  abilities.update(0.025, rooster, { yaw: 0, jump: false });
  abilities.activate(rooster, 0);
  abilities.update(0.025, rooster, { yaw: 0, jump: true });
  assert.ok(rooster.lastMotion.lift > 0);
  assert.equal(abilities.flaps, 1);
  for (let i = 0; i < 16; i++) abilities.update(0.025, rooster, { jump: true });
  assert.equal(abilities.flaps, 1, 'holding jump does not spend the remaining flaps');
  abilities.update(0.025, rooster, { jump: false });
  abilities.update(0.025, rooster, { jump: true });
  assert.equal(abilities.flaps, 2, 'pressing jump again produces another flap');
});

test('any animal can kick off a wall while climbing', () => {
  const city = { chunkAt: () => -1, raycast: () => Infinity };
  const events = [];
  const abilities = new ZodiacAbilities({ city, onEffect: (effect) => events.push(effect) });
  const actor = actorAt(0, 8, 0);
  actor.grounded = false;
  actor.climbing = true;
  abilities.select('snake');
  abilities.update(0.025, actor, { yaw: 0, jump: true });
  assert.equal(actor.lastMotion.lift, 22);
  assert.equal(actor.lastMotion.allowClimb, false);
  assert.ok(events.some(({ id, type }) => id === 'snake' && type === 'ink'));
  abilities.update(0.5, actor, { jump: true });
  assert.equal(actor.lastMotion.lift, undefined, 'holding jump cannot kick off another wall');
  abilities.update(0.025, actor, { jump: false });
  abilities.update(0.025, actor, { jump: true });
  assert.equal(actor.lastMotion.lift, 22);
});

test('a closed ink loop refunds part of the ability cooldown', () => {
  const city = { chunkAt: () => -1, raycast: () => Infinity };
  const abilities = new ZodiacAbilities({ city, onEffect: () => {} });
  const actor = actorAt();
  abilities.select('ox');
  abilities.activate(actor, 0);
  abilities.update(0.025, actor, { yaw: 0 });
  const before = abilities.remaining;
  abilities.refund(0.75);
  assert.ok(abilities.remaining < before - 0.7);
});
