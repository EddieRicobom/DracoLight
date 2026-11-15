import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceDiveSpeed, advanceDiveImpact } from '../src/dive.js';

test('a dive gains speed beyond the propulsion target without a hard ceiling', () => {
  let speed = 400;
  for (let frame = 0; frame < 600; frame++) {
    speed = advanceDiveSpeed(speed, 1 / 60, { targetSpeed: 400, verticalDirection: -1 });
  }
  assert.ok(speed > 850, `expected substantial dive acceleration, got ${speed}`);
});

test('even an extremely fast sustained dive keeps accelerating until braking', () => {
  const fast = 10000;
  const faster = advanceDiveSpeed(fast, 1, { targetSpeed: 400, verticalDirection: -1 });
  assert.ok(faster > fast);
  const braked = advanceDiveSpeed(fast, 1, { targetSpeed: 42, verticalDirection: -1, braking: true });
  assert.ok(braked < fast);
});

test('level flight retains most speed gained during a dive', () => {
  const afterDive = 1000;
  let speed = afterDive;
  for (let frame = 0; frame < 60; frame++) {
    speed = advanceDiveSpeed(speed, 1 / 60, { targetSpeed: 95, verticalDirection: 0 });
  }
  assert.ok(speed > afterDive * 0.95, `momentum disappeared too quickly: ${speed}`);
});

test('climbing spends speed against gravity without an abrupt clamp to cruise', () => {
  const climbing = advanceDiveSpeed(1000, 1, { targetSpeed: 95, verticalDirection: 1 });
  const level = advanceDiveSpeed(1000, 1, { targetSpeed: 95, verticalDirection: 0 });
  assert.ok(climbing < level);
  assert.ok(climbing > 900);
});

test('propulsion recovers low speed while stationary time changes nothing', () => {
  assert.ok(advanceDiveSpeed(20, 1, { targetSpeed: 95 }) > 20);
  assert.equal(advanceDiveSpeed(200, 0, { verticalDirection: -1 }), 200);
  assert.equal(advanceDiveSpeed(5, 10, { targetSpeed: 0, verticalDirection: 1 }), 0);
});

test('one impact fires when a fast dive levels out, without repeating', () => {
  let impact = advanceDiveImpact(null, { speed: 650, verticalDirection: -0.7 });
  assert.equal(impact.armed, true);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: -0.3 });
  assert.equal(impact.triggered, false); // orientation hysteresis
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: 0 });
  assert.equal(impact.triggered, true);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: 0 });
  assert.equal(impact.triggered, false);
});

test('braking during a fast dive fires once and a later dive can rearm', () => {
  let impact = advanceDiveImpact(null, { speed: 650, verticalDirection: -0.7 });
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: -0.7, braking: true });
  assert.equal(impact.triggered, true);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: -0.7, braking: true });
  assert.equal(impact.triggered, false);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: -0.7 });
  assert.equal(impact.armed, true);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: 0 });
  assert.equal(impact.triggered, true);
});

test('braking in fast level flight emits one wave', () => {
  let impact = advanceDiveImpact(null, { speed: 650, verticalDirection: 0 });
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: 0, braking: true });
  assert.equal(impact.triggered, true);
  impact = advanceDiveImpact(impact, { speed: 650, verticalDirection: 0, braking: true });
  assert.equal(impact.triggered, false);
});

test('slow dives never emit an impact and falling below reset speed disarms', () => {
  let impact = advanceDiveImpact(null, { speed: 450, verticalDirection: -1 });
  impact = advanceDiveImpact(impact, { speed: 450, verticalDirection: 0 });
  assert.equal(impact.triggered, false);
  impact = advanceDiveImpact(impact, { speed: 550, verticalDirection: -1 });
  impact = advanceDiveImpact(impact, { speed: 350, verticalDirection: -1 });
  impact = advanceDiveImpact(impact, { speed: 550, verticalDirection: 0 });
  assert.equal(impact.triggered, false);
});
