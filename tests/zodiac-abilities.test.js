import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZodiacAbilities, ZODIAC_ABILITIES, ZODIAC_IMPACTS } from '../src/zodiac-abilities.js';

globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }) };
const { Boykisser } = await import('../src/boykisser.js');

const DT = 0.025;
const WALL_YAW = Math.PI / 2;

function setup(id, wall = false) {
  const events = [];
  const city = {
    chunkAt(x, y) {
      return wall && x >= 5 && x < 15 && y >= 0 && y < 10 ? 0 : -1;
    },
    raycast({ x, y }, direction, maxDistance) {
      let distance = Infinity;
      if (direction.y < 0) {
        const roof = wall && x >= 5 && x < 15 && y >= 10;
        distance = y - (roof ? 10 : 0);
      } else if (wall && x <= 5 && direction.x > 0 && y > 0 && y < 10) distance = (5 - x) / direction.x;
      return distance <= maxDistance ? distance : Infinity;
    },
  };
  const actor = new Boykisser(new THREE.Scene(), city, { yaw: WALL_YAW });
  const abilities = new ZodiacAbilities({
    city,
    onEffect: ({ id, type, position }) => events.push({ id, type, position: position.clone() }),
  });
  abilities.select(id);
  const step = (frameCount = 1, input = {}) => {
    for (let frame = 0; frame < frameCount; frame++) abilities.update(DT, actor, { yaw: WALL_YAW, ...input });
  };
  step();
  const use = () => abilities.activate(actor, WALL_YAW);
  const impacts = () => events.filter(({ type }) => type === 'impact');
  return { actor, abilities, step, use, impacts };
}

test('all eleven zodiac animals have an ability and three produce world impacts', () => {
  assert.equal(Object.keys(ZODIAC_ABILITIES).length, 11);
  assert.deepEqual(Object.keys(ZODIAC_IMPACTS), ['ox', 'tiger', 'pig']);
  for (const id of Object.keys(ZODIAC_ABILITIES)) {
    const { abilities, step, use } = setup(id);
    assert.ok(use(), id);
    assert.ok(!use(), id);
    step();
    assert.ok(abilities.remaining > 0, id);
  }
});

test('Rat dodges with directional input, and Snake can slide along a wall', () => {
  const rat = setup('rat');
  rat.use();
  rat.step(10, { strafe: 1 });
  assert.ok(rat.actor.position.z > 10);
  assert.ok(Math.abs(rat.actor.position.x) < 0.01);

  const snake = setup('snake', true);
  snake.actor.position.x = 4;
  snake.use();
  snake.step(8, { forward: 1, strafe: 1 });
  assert.ok(snake.actor.position.x < 4.3);
  assert.ok(snake.actor.position.z > 3);
});

test('Ox emits a single impact at the wall and cannot tunnel through it', () => {
  const { actor, step, use, impacts } = setup('ox', true);
  use();
  step(34);
  assert.equal(impacts().length, 1);
  assert.equal(impacts()[0].position.x, 5);
  assert.ok(actor.position.x < 4.3);
  assert.equal(actor.position.y, 0);
});

test('Tiger launches forward and impacts the ground once on landing', () => {
  const { actor, step, use, impacts } = setup('tiger');
  use();
  step(11);
  assert.ok(actor.position.x > 10 && actor.position.y > 2);
  assert.equal(impacts().length, 0);
  step(45);
  assert.equal(impacts().length, 1);
  assert.equal(impacts()[0].position.y, 0);
});

test('Rabbit can chain three separated lifts and changing characters preserves cooldown', () => {
  const { actor, abilities, step, use } = setup('rabbit');
  use();
  step();
  assert.ok(!use(), 'a second button press cannot stack on the same instant');
  step(10);
  const firstHeight = actor.position.y;
  assert.ok(use());
  step(10);
  assert.ok(actor.position.y > firstHeight + 2);
  assert.ok(use());
  step(10);
  assert.ok(!use());
  abilities.select('boykisser');
  assert.equal(abilities.active, false);
  step();
  abilities.select('rabbit');
  assert.ok(!use(), 'switching back cannot reset this animal’s cooldown');
  step(135);
  assert.ok(use());
});

test('Horse gains speed while moving and Goat climbs more quickly than the base actor', () => {
  const horse = setup('horse');
  horse.use();
  horse.step(1, { forward: 1 });
  const initial = horse.actor.position.x;
  horse.step(36, { forward: 1 });
  const beforeLastFrame = horse.actor.position.x;
  horse.step(1, { forward: 1 });
  assert.ok(horse.actor.position.x - beforeLastFrame > initial * 1.7);

  const goat = setup('goat', true);
  const base = setup('boykisser', true);
  goat.use();
  goat.step(14, { forward: 1, sprint: true });
  base.step(14, { forward: 1, sprint: true });
  assert.ok(base.actor.position.y > 0);
  assert.ok(goat.actor.position.y > base.actor.position.y * 2.5);
});

test('A wall kick carries the animal away from the climbing surface even when looking elsewhere', () => {
  const { actor, step } = setup('horse', true);
  actor.position.x = 4;
  step(6, { forward: 1 });
  assert.equal(actor.climbing, true);
  const wallPosition = actor.position.clone();

  step(1, { forward: 1, jump: true, yaw: 0 });
  assert.ok(actor.position.x < wallPosition.x);
  assert.ok(actor.position.y > wallPosition.y);
  step(3, { forward: 1, jump: true });
  assert.ok(actor.position.x < wallPosition.x - 1);
  assert.equal(actor.climbing, false);
});

test('Monkey vaults higher when aimed at a façade and Rooster can glide in the air', () => {
  const wall = setup('monkey', true);
  const field = setup('monkey');
  for (const actor of [wall, field]) {
    actor.use();
    actor.step(9);
  }
  assert.ok(wall.actor.position.y > field.actor.position.y + 3);
  assert.ok(wall.actor.position.x > 0);

  const { actor, use, step } = setup('rooster');
  actor.position.y = 25;
  actor.grounded = false;
  actor.velocity.y = -30;
  use();
  step(60, { forward: 1 });
  assert.ok(actor.position.y > 21);
  assert.ok(actor.position.x > 24);
});

test('Dog expands relic guidance temporarily and Pig lands on a roof during a fast stomp', () => {
  const dog = setup('dog');
  dog.use();
  dog.step();
  assert.equal(dog.abilities.relicGuideRange, 1100);
  dog.step(285);
  assert.equal(dog.abilities.relicGuideRange, undefined);

  const { actor, use, step, impacts } = setup('pig', true);
  actor.position.set(9, 21.8, 0);
  actor.grounded = false;
  use();
  step(17);
  assert.equal(impacts().length, 1);
  assert.equal(impacts()[0].position.y, 10);
  assert.equal(actor.position.y, 10);
});
