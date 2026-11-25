import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZodiacAbilities, ZODIAC_ABILITIES, ZODIAC_IMPACTS } from '../src/zodiac-abilities.js';

globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }) };
const { GroundCharacter } = await import('../src/ground-character.js');

const DT = 0.025;
const WALL_YAW = Math.PI / 2;

function setup(id, wall = false, wallHeight = 10) {
  const events = [];
  const walls = wall ? [{ x: 5, end: 15 }] : [];
  const city = {
    chunkAt(x, y) {
      return y >= 0 && y < wallHeight && walls.some(({ x: start, end }) => x >= start && x < end) ? 0 : -1;
    },
    raycast({ x, y }, direction, maxDistance) {
      let distance = Infinity;
      if (direction.y < 0) {
        const roof = y >= wallHeight && walls.some(({ x: start, end }) => x >= start && x < end);
        distance = y - (roof ? wallHeight : 0);
      } else if (direction.x > 0 && y > 0 && y < wallHeight) {
        const nextWall = walls.find(({ x: start }) => x <= start);
        if (nextWall) distance = (nextWall.x - x) / direction.x;
      }
      return distance <= maxDistance ? distance : Infinity;
    },
  };
  const actor = new GroundCharacter(new THREE.Scene(), city, { yaw: WALL_YAW });
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
  return { actor, abilities, step, use, impacts, walls };
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

test('Ox keeps charging through a passage but only breaks the first wall', () => {
  const { actor, step, use, impacts, walls } = setup('ox', true);
  walls.push({ x: 18, end: 30 });
  use();
  while (impacts().length === 0 && actor.position.x < 4) step();
  assert.equal(impacts().length, 1);
  walls.shift();
  step(25);
  assert.equal(impacts().length, 1);
  assert.ok(actor.position.x > 15 && actor.position.x < 18);
});

test('Ox charges in the input direction and turns gradually while committed', () => {
  const { actor, step, use } = setup('ox');
  use();
  step(4, { strafe: 1 });
  assert.ok(actor.position.z > 6);
  assert.ok(Math.abs(actor.position.x) < 0.01);
  const beforeTurn = actor.position.clone();
  step(8, { forward: 1 });
  assert.ok(actor.position.x > beforeTurn.x + 1);
  assert.ok(actor.position.z > beforeTurn.z + 10);
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

test('Tiger can steer the pounce without snapping straight to the new direction', () => {
  const { actor, step, use } = setup('tiger');
  use();
  step();
  const launch = actor.position.clone();
  step(8, { strafe: 1 });
  const turn = actor.position.clone().sub(launch);
  assert.ok(turn.x > 9 && turn.z > 2);
});

test('Tiger can cut a pounce short with a dive that lands exactly once', () => {
  const dive = setup('tiger');
  const pounce = setup('tiger');
  for (const tiger of [dive, pounce]) {
    tiger.use();
    tiger.step(12);
  }
  dive.step(8, { jump: true });
  pounce.step(8);
  assert.equal(dive.impacts().length, 1);
  assert.equal(dive.impacts()[0].position.y, 0);
  assert.equal(pounce.impacts().length, 0);
  dive.step(20);
  assert.equal(dive.impacts().length, 1);
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
  abilities.select('unsupported');
  assert.equal(abilities.active, false);
  step();
  abilities.select('rabbit');
  assert.ok(!use(), 'switching back cannot reset this animal’s cooldown');
  step(135);
  assert.ok(use());
});

test('Rabbit accepts an early follow-up without applying the lift before the hop interval', () => {
  const { actor, abilities, step, use } = setup('rabbit');
  use();
  step(7);
  assert.equal(abilities.hops, 1);
  assert.ok(use());
  const lift = actor.velocity.y;
  step();
  assert.ok(actor.velocity.y < lift);
  step(2);
  assert.equal(abilities.hops, 2);
  assert.ok(actor.velocity.y > lift);
});

test('Rabbit reports cooldown when a late second hop leaves too little time to chain a third', () => {
  const { abilities, step, use } = setup('rabbit');
  use();
  step(61);
  assert.ok(use());
  step();
  assert.equal(abilities.hops, 2);
  assert.ok(abilities.remaining > 3);
  assert.equal(use(), false);
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
  const base = setup('unsupported', true);
  goat.use();
  goat.step(14, { forward: 1, sprint: true });
  base.step(14, { forward: 1, sprint: true });
  assert.ok(base.actor.position.y > 0);
  assert.ok(goat.actor.position.y > base.actor.position.y * 2.5);
});

test('Horse loses gallop speed when blocked and on immediate reversal', () => {
  const { actor, step, use } = setup('horse', true);
  actor.position.x = -60;
  use();
  step(30, { forward: 1 });
  const beforeReversal = actor.position.x;
  step(1, { forward: -1 });
  assert.ok(beforeReversal - actor.position.x <= actor.runSpeed * DT * 1.01);
  step(35, { forward: 1 });
  const wallPosition = actor.position.x;
  step(16, { forward: 1 });
  assert.equal(actor.position.x, wallPosition);
  assert.equal(actor.climbing, false);
});

test('Horse can carry gallop momentum into a jump but cannot build it in the air', () => {
  const { abilities, actor, step, use } = setup('horse');
  use();
  step(30, { forward: 1 });
  const gallop = abilities.gallop;
  assert.ok(gallop > 0.8);
  const beforeJump = actor.position.x;
  step(1, { forward: 1, jump: true });
  assert.equal(actor.grounded, false);
  assert.ok(actor.position.x - beforeJump > actor.runSpeed * DT * 1.6);
  step(8, { forward: 1 });
  assert.ok(abilities.gallop < gallop * 0.5);
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

test('Monkey rebounds from a reachable façade when the player taps jump', () => {
  const { actor, step, use } = setup('monkey', true, 30);
  use();
  step(8);
  const wallPosition = actor.position.clone();
  const rising = actor.velocity.y;
  step(3, { jump: true });
  assert.ok(actor.position.x < wallPosition.x - 2);
  assert.ok(actor.velocity.y > rising);
});

test('Monkey buffers a jump pressed near a façade and rebounds when reaching it', () => {
  const { actor, step, use } = setup('monkey', true, 30);
  actor.position.x = -8;
  use();
  step(5);
  assert.ok(actor.position.x < 0);
  step(1, { jump: true });
  const beforeRebound = actor.position.x;
  step(12);
  assert.ok(actor.position.x < beforeRebound);
});

test('Rooster flaps once per jump press and caps its fall during the glide', () => {
  const { actor, abilities, step, use } = setup('rooster');
  actor.position.y = 25;
  actor.grounded = false;
  use();
  step(24);
  assert.ok(actor.velocity.y >= -5);
  step(24, { jump: true });
  assert.equal(abilities.flaps, 1);
  step();
  step(1, { jump: true });
  assert.equal(abilities.flaps, 2);
});

test('Rooster gains a brief forward boost on a flap while retaining movement control', () => {
  const { actor, step, use } = setup('rooster');
  actor.position.y = 25;
  actor.grounded = false;
  use();
  step(14, { forward: 1 });
  const beforeFlap = actor.position.clone();
  step(1, { strafe: 1, jump: true });
  assert.equal(actor.position.x, beforeFlap.x);
  assert.ok(actor.position.z - beforeFlap.z > actor.walkSpeed * DT * 1.4);
  step(10, { strafe: 1 });
  const afterBoost = actor.position.z;
  step(1, { strafe: 1 });
  assert.ok(actor.position.z - afterBoost < actor.walkSpeed * DT * 1.3);
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

test('Dog runs faster while tracking and spends its masterpiece only once per scent', () => {
  const { actor, abilities, step, use } = setup('dog');
  abilities.addInk(1);
  use();
  step(10, { forward: 1, sprint: true });
  assert.ok(actor.position.x > actor.runSpeed * DT * 10 * 1.2);
  assert.equal(abilities.relicGuideRange, 1375);
  assert.equal(abilities.ink, 0);
  abilities.refund(100);
  assert.ok(!use());
  step(365);
  assert.ok(use());
});

test('Pig rolls from the ground and stomps exactly once at the end of the roll', () => {
  const { actor, step, use, impacts } = setup('pig');
  use();
  step(8);
  assert.ok(actor.position.x > 9 && actor.position.y > 1);
  assert.equal(impacts().length, 0);
  step(50);
  assert.equal(impacts().length, 1);
  assert.equal(impacts()[0].position.y, 0);
  assert.ok(impacts()[0].position.x > 15);
});
