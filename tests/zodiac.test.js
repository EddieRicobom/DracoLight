import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Scene } from 'three';
import { createZodiacAvatar, ZODIAC_ANIMALS } from '../src/zodiac.js';
import { isZodiacSpecies } from '../src/zodiac-species.js';

test('every zodiac animal has a grounded, inexpensive, shadow-casting avatar', () => {
  assert.equal(ZODIAC_ANIMALS.length, 11);
  assert.equal(new Set(ZODIAC_ANIMALS.map(({ id }) => id)).size, ZODIAC_ANIMALS.length);
  for (const { id } of ZODIAC_ANIMALS) {
    const avatar = createZodiacAvatar(id, { height: 2.7 });
    const bounds = new Box3().setFromObject(avatar.root);
    assert.ok(Math.abs(bounds.min.y) < 1e-9, id);
    assert.ok(Math.abs(bounds.max.y - 2.7) < 1e-9, id);

    const meshes = [];
    avatar.root.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    assert.ok(meshes.length >= 3 && meshes.length <= 7, id);
    assert.ok(meshes.every((mesh) => mesh.castShadow && mesh.geometry.hasAttribute('color')), id);
    const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
    assert.ok(triangleCount < 3000, id);
    avatar.dispose();
  }
});

test('every zodiac rig moves in a run and changes pose in the air', () => {
  for (const { id } of ZODIAC_ANIMALS) {
    const avatar = createZodiacAvatar(id);
    const body = avatar.root.children[0];
    const pose = () => {
      const rotations = [];
      body.traverse((object) => rotations.push(...object.rotation.toArray().slice(0, 3)));
      return rotations;
    };
    const idle = pose();
    avatar.animate(0.08, { state: 'run', speed: 35 });
    const running = pose();
    avatar.animate(0.08, { state: 'air', verticalSpeed: 15 });
    const jumping = pose();
    assert.notDeepEqual(idle, running, id);
    assert.notDeepEqual(running, jumping, id);
    assert.ok(jumping.every(Number.isFinite), id);
    avatar.dispose();
  }
});

test('ground movement keeps visible differences in each species’ gait', () => {
  const rabbit = createZodiacAvatar('rabbit');
  const horse = createZodiacAvatar('horse');
  const snake = createZodiacAvatar('snake');
  const legs = (avatar) => avatar.root.children[0].children.slice(2, 6);
  const ramp = { state: 'run', speed: 35 };
  for (const avatar of [rabbit, horse, snake]) avatar.animate(0.1, ramp);

  const [rabbitFrontLeft, rabbitFrontRight, rabbitBackLeft, rabbitBackRight] = legs(rabbit);
  assert.equal(rabbitFrontLeft.rotation.x, rabbitFrontRight.rotation.x);
  assert.equal(rabbitBackLeft.rotation.x, rabbitBackRight.rotation.x);
  assert.ok(rabbitFrontLeft.rotation.x * rabbitBackLeft.rotation.x < 0);

  const [horseFrontLeft, horseFrontRight] = legs(horse);
  assert.notEqual(horseFrontLeft.rotation.x, horseFrontRight.rotation.x);

  const [snakeTail, snakeNeck] = snake.root.children[0].children;
  assert.notEqual(snakeTail.rotation.y, 0);
  assert.notEqual(snakeNeck.rotation.y, 0);
  assert.notEqual(snakeTail.rotation.y, snakeNeck.rotation.y);
  const [snakeTip] = snakeTail.children;
  assert.notEqual(snakeTip.rotation.y, 0);
  assert.notEqual(snakeTip.rotation.y, snakeTail.rotation.y);
  for (const avatar of [rabbit, horse, snake]) avatar.dispose();
});

test('the rabbit changes its jump pose on descent and recovers after landing', () => {
  const rabbit = createZodiacAvatar('rabbit');
  const [body] = rabbit.root.children;
  const rearLeg = body.children[4];
  rabbit.animate(0.05, { state: 'air', verticalSpeed: 18 });
  const jumpAngle = rearLeg.rotation.x;
  rabbit.animate(0.05, { state: 'air', verticalSpeed: -28 });
  assert.ok(rearLeg.rotation.x < jumpAngle);
  assert.equal(body.scale.y, 1);

  rabbit.animate(0.05, { state: 'idle' });
  assert.ok(body.scale.y < 0.92);
  rabbit.animate(0.3, { state: 'idle' });
  assert.ok(body.scale.y > 0.99);
  assert.ok(Math.abs(new Box3().setFromObject(rabbit.root).min.y) < 1e-9);
  rabbit.dispose();
});

test('ability poses open the rooster’s wings and lower the dog’s nose', () => {
  const rooster = createZodiacAvatar('rooster');
  const dog = createZodiacAvatar('dog');
  const roosterWing = rooster.root.children[0].children[2];
  const dogHead = dog.root.children[0].children[1];
  const folded = Math.abs(roosterWing.rotation.y);
  rooster.animate(0.15, { ability: 'rooster' });
  assert.ok(Math.abs(roosterWing.rotation.y) < folded / 2);
  rooster.animate(0.3, { state: 'idle' });
  assert.ok(Math.abs(roosterWing.rotation.y) > folded * 0.95);

  dog.animate(0.15, { ability: 'dog' });
  assert.ok(dogHead.rotation.x > 0.24);
  dog.animate(0.3, { state: 'idle' });
  assert.ok(Math.abs(dogHead.rotation.x) < 0.05);
  rooster.dispose();
  dog.dispose();
});

test('disposing an avatar detaches and releases its resources only', () => {
  const own = createZodiacAvatar('rabbit');
  const other = createZodiacAvatar('rabbit');
  const scene = new Scene();
  scene.add(own.root, other.root);
  const ownMesh = own.root.children[0].children[0];
  const otherMesh = other.root.children[0].children[0];
  let released = 0;
  ownMesh.geometry.addEventListener('dispose', () => released++);
  ownMesh.material.addEventListener('dispose', () => released++);
  let otherReleased = 0;
  otherMesh.geometry.addEventListener('dispose', () => otherReleased++);
  otherMesh.material.addEventListener('dispose', () => otherReleased++);
  own.dispose();
  assert.equal(released, 2);
  assert.equal(otherReleased, 0);
  assert.deepEqual(scene.children, [other.root]);
  other.dispose();
  assert.equal(isZodiacSpecies('rabbit'), true);
  assert.equal(isZodiacSpecies('dragon'), false);
  assert.equal(isZodiacSpecies('constructor'), false);
  assert.throws(() => createZodiacAvatar('constructor'), RangeError);
});
