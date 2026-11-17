import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createPlayerCamera } from '../src/player-camera.js';

function setup(raycast = () => Infinity) {
  const camera = new PerspectiveCamera(70, 16 / 9, 1, 30000);
  const update = createPlayerCamera(camera, { cruiseSpeed: 95, accelerateSpeed: 160, raycast });
  const state = {
    walking: false, position: new Vector3(0, 115, 0), forward: new Vector3(0, 0, -1),
    yaw: Math.PI, pitch: 0, speed: 95, actualSpeed: 95, boosting: false, shake: 0, diorama: true,
  };
  return {
    camera, state,
    advance(frames = 180) {
      for (let i = 0; i < frames; i++) update(1 / 60, state);
      camera.updateMatrixWorld();
    },
  };
}

test('slow flight blends into the elevated view and returns to chase framing at speed', () => {
  const { camera, state, advance } = setup();
  const chase = setup();
  chase.state.diorama = false;
  advance();
  const slowFov = camera.fov;
  const slowAltitude = camera.position.y;
  assert.ok(slowFov < 40 && slowAltitude > state.position.y + 100);

  state.actualSpeed = chase.state.actualSpeed = 350;
  state.speed = chase.state.speed = 350;
  chase.advance();
  advance(1);
  assert.ok(camera.fov > slowFov && camera.fov < chase.camera.fov);
  assert.ok(camera.position.y < slowAltitude && camera.position.y > chase.camera.position.y);
  advance();
  assert.ok(camera.position.distanceTo(chase.camera.position) < 0.01);
  assert.ok(Math.abs(camera.fov - chase.camera.fov) < 0.1);

  state.actualSpeed = state.speed = 95;
  advance();
  assert.ok(Math.abs(camera.fov - slowFov) < 0.1);
  state.boosting = true;
  advance();
  assert.ok(camera.fov > 70);
});

test('a narrow street gives slow flight a clear chase view until the dragon leaves it', () => {
  let wallX = Infinity;
  const raycast = (origin, direction, distance) => {
    if (direction.x <= 0) return Infinity;
    const hit = (wallX - origin.x) / direction.x;
    return hit >= 0 && hit <= distance && origin.y + direction.y * hit < 102 ? hit : Infinity;
  };
  const { camera, state, advance } = setup(raycast);
  state.position.y = 15;
  advance();
  const openFov = camera.fov;
  assert.ok(camera.position.x > 50 && openFov < 40);

  wallX = 13;
  advance(1);
  const distance = camera.position.distanceTo(state.position);
  const direction = camera.position.clone().sub(state.position).normalize();
  assert.ok(distance > 55, 'the camera keeps the dragon at a usable distance');
  assert.equal(raycast(state.position, direction, distance), Infinity);
  assert.ok(camera.fov > openFov && camera.fov < 70, 'the lens transitions smoothly');
  advance();
  assert.ok(camera.fov > 70 && camera.position.x < wallX);

  wallX = Infinity;
  advance();
  assert.ok(camera.position.x > 50 && Math.abs(camera.fov - openFov) < 0.1);
});

test('the walking diorama maps forward and right to the corresponding screen directions', () => {
  const { camera, state, advance } = setup();
  state.walking = true;
  state.position.y = 0;
  const actorCenter = new Vector3(0, 1.7, 0);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    state.yaw = yaw;
    advance();
    const center = actorCenter.clone().project(camera);
    const forward = actorCenter.clone().add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw))).project(camera);
    const right = actorCenter.clone().add(new Vector3(-Math.cos(yaw), 0, Math.sin(yaw))).project(camera);
    assert.ok(forward.y > center.y && Math.abs(forward.x - center.x) < 0.001);
    assert.ok(right.x > center.x && Math.abs(right.y - center.y) < 0.001);
    assert.ok(Math.abs(center.y) < 1 && camera.position.y > 35);
  }
});

test('the walking diorama pulls in from walls and restores its framing on open ground', () => {
  let wallDistance = 10;
  const { camera, state, advance } = setup(() => wallDistance);
  state.walking = true;
  state.position.y = 0;
  advance();
  const anchor = new Vector3(0, 2.5, 0);
  assert.ok(camera.position.distanceTo(anchor) < wallDistance);
  const blockedFov = camera.fov;
  wallDistance = Infinity;
  advance();
  assert.ok(camera.position.distanceTo(anchor) > 45);
  assert.ok(camera.fov < blockedFov);
});
