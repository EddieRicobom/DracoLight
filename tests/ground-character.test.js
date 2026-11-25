import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// City loads browser textures at module evaluation; no image data is needed here.
globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }) };
const { GroundCharacter } = await import('../src/ground-character.js');

function testCity() {
  return {
    chunkAt(x, y, z) {
      return x >= 5 && x < 10 && Math.abs(z) < 5 && y >= 0 && y < 10 ? 1 : -1;
    },
    raycast(origin, direction, maxDistance) {
      assert.equal(direction.y, -1);
      const roof = origin.x >= 5 && origin.x < 10 && Math.abs(origin.z) < 5 && origin.y >= 10;
      const distance = origin.y - (roof ? 10 : 0);
      return distance <= maxDistance ? distance : Infinity;
    },
  };
}

test('runs on the ground, jumps, and climbs a ten metre wall onto its roof', () => {
  const player = new GroundCharacter(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(0, 40, 0), { ground: true, yaw: Math.PI / 2 });
  assert.equal(player.position.y, 0);
  player.update(1 / 60);
  assert.equal(player.state, 'idle');
  player.update(1 / 60, { jump: true });
  assert.ok(player.position.y > 0);
  let climbed = false;
  for (let frame = 0; frame < 240 && player.position.x < 7; frame++) {
    player.update(1 / 60, { forward: 1, sprint: true, yaw: Math.PI / 2 });
    climbed ||= player.state === 'climb';
  }
  for (let frame = 0; frame < 30; frame++) player.update(1 / 60);
  assert.equal(climbed, true);
  assert.ok(player.position.x >= 7, `expected to get onto the roof; x=${player.position.x}`);
  assert.ok(player.position.y >= 9.9, `expected to reach roof; y=${player.position.y}`);
  player.dispose();
});

test('diagonal input does not exceed running speed', () => {
  const player = new GroundCharacter(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(-20, 0, 20), { ground: true, yaw: 0 });
  const before = player.position.clone();
  player.update(0.05, { forward: 1, strafe: 1, sprint: true, yaw: 0 });
  assert.ok(player.position.distanceTo(before) <= player.runSpeed * 0.05 + 0.001);
  player.dispose();
});

test('can jump on the first frame after teleporting to a clear street', () => {
  const player = new GroundCharacter(new THREE.Scene(), testCity());
  player.teleport(new THREE.Vector3(0, 40, 0), { ground: true });
  assert.equal(player.update(0.05, { jump: true, sweep: true }), 'air');
  assert.ok(player.position.y > 0);
  player.dispose();
});

test('half stick input gives half speed and movement facing leaves the camera yaw intact', () => {
  const player = new GroundCharacter(new THREE.Scene(), testCity());
  const start = new THREE.Vector3(-20, 0, 20);
  player.teleport(start, { ground: true, yaw: 0 });
  player.update(0.05, { strafe: 0.5, yaw: 0, faceMovement: true });
  assert.ok(Math.abs(start.x - player.position.x - player.walkSpeed * 0.05 / 2) < 0.001);
  assert.equal(player.yaw, 0);
  assert.ok(player.facingYaw < -0.9);
  assert.equal(player.root.rotation.y, player.facingYaw);
  player.teleport(start, { yaw: 1 });
  assert.equal(player.facingYaw, 1);
  player.dispose();
});

test('swept movement catches a thin barrier at high speed and lets a leap clear the roof edge', () => {
  const city = testCity();
  const player = new GroundCharacter(new THREE.Scene(), city);
  const yaw = Math.PI / 2;
  player.teleport(new THREE.Vector3(4, 9.1, 0), { yaw });
  player.update(0.05, { forward: 1, sprint: true, lift: 42, allowClimb: false, sweep: true });
  assert.ok(player.position.x > 5 && player.position.y > 10);

  city.chunkAt = (x, y) => x >= 2 && x <= 2.5 && y < 10 ? 1 : -1;
  player.teleport(new THREE.Vector3(), { yaw });
  player.update(0.05, { forward: 1, sprint: true, speedScale: 3, allowClimb: false, sweep: true });
  assert.ok(player.position.x < 2);
  player.dispose();
});

test('swept movement lands on the higher roof edge and falls after clearing it', () => {
  const city = testCity();
  const raycast = city.raycast;
  let rayCount = 0;
  city.raycast = (origin, direction, maxDistance) => {
    rayCount++;
    if (origin.x >= 3 && origin.x < 5 && origin.y >= 5) {
      const lowerRoofDistance = origin.y - 5;
      if (lowerRoofDistance <= maxDistance) return lowerRoofDistance;
    }
    return raycast(origin, direction, maxDistance);
  };
  const player = new GroundCharacter(new THREE.Scene(), city);
  const yaw = -Math.PI / 2;
  player.teleport(new THREE.Vector3(0, 0, 0), { ground: true, yaw });
  player.update(0.05, { sweep: true });
  assert.equal(rayCount, 1);

  player.teleport(new THREE.Vector3(4.6, 12, 0), { yaw });
  player.update(0.05, { sweep: true, lift: -100 });
  assert.ok(Math.abs(player.position.y - 10) < 0.001);
  assert.equal(player.grounded, true);

  player.update(0.05, { forward: 1, sweep: true });
  assert.ok(player.position.y < 10);
  assert.equal(player.grounded, false);
  player.dispose();
});

test('forward and strafe follow the chase camera at different headings', () => {
  const player = new GroundCharacter(new THREE.Scene(), testCity());
  const camera = new THREE.PerspectiveCamera();
  const start = new THREE.Vector3(-20, 0, 20);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    camera.position.copy(start).addScaledVector(forward, -12).add(new THREE.Vector3(0, 5, 0));
    camera.lookAt(start.clone().addScaledVector(forward, 5).add(new THREE.Vector3(0, 2.5, 0)));
    camera.updateMatrixWorld();
    const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    screenRight.y = 0;
    screenRight.normalize();
    for (const [input, expected] of [
      [{ forward: 1 }, forward],
      [{ forward: -1 }, forward.clone().negate()],
      [{ strafe: 1 }, screenRight],
      [{ strafe: -1 }, screenRight.clone().negate()],
    ]) {
      player.teleport(start, { ground: true, yaw });
      player.update(0.05, { ...input, yaw });
      const delta = player.position.clone().sub(start).setY(0).normalize();
      assert.ok(delta.dot(expected) > 0.999, `${JSON.stringify(input)} at yaw ${yaw} should match camera direction`);
    }
  }
  player.dispose();
});
