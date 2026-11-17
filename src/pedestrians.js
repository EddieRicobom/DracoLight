import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, rng } from './util.js';

const CENTER_LIMIT = 135;
const SIDEWALK_INSET = 3.55;
const BLOCK_WIDTH = 70;
const SIDE_LENGTH = BLOCK_WIDTH - 2 * SIDEWALK_INSET;
const ROUTE_LENGTH = SIDE_LENGTH * 4;
const VIEW_DISTANCE = 185;
const SCARE_DISTANCE = 33;
const FLIGHT_RESET_DISTANCE = 200;
const UPDATE_INTERVAL = 1 / 30;
const LIMBS = 4;

function sidewalkPoint(block, offset, target) {
  const wrapped = THREE.MathUtils.euclideanModulo(offset, ROUTE_LENGTH);
  const side = Math.floor(wrapped / SIDE_LENGTH);
  const along = wrapped - side * SIDE_LENGTH;
  const x = block.x0 + SIDEWALK_INSET;
  const z = block.z0 + SIDEWALK_INSET;
  if (side === 0) target.set(x + along, 0.3, z);
  else if (side === 1) target.set(x + SIDE_LENGTH, 0.3, z + along);
  else if (side === 2) target.set(x + SIDE_LENGTH - along, 0.3, z + SIDE_LENGTH);
  else target.set(x, 0.3, z + SIDE_LENGTH - along);
  return target;
}

function shadeFaces(geometry, base) {
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const shade = base * (0.83 + normals.getY(i) * 0.14 + normals.getZ(i) * 0.03);
    colors.fill(shade, i * 3, i * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function torsoGeometry() {
  // The upper body is a single mesh with its pivot at the hips.
  const top = new THREE.CylinderGeometry(0.29, 0.23, 0.56, 7)
    .scale(1, 1, 0.64).translate(0, 0.27, 0);
  const jacket = shadeFaces(top.toNonIndexed(), 0.63);
  const head = shadeFaces(new THREE.IcosahedronGeometry(0.20, 0)
    .scale(0.92, 1.17, 0.96).translate(0, 0.72, 0.015), 0.91);
  const geometry = mergeGeometries([jacket, head]);
  top.dispose();
  jacket.dispose();
  head.dispose();
  return geometry;
}

function instanceMesh(geometry, material, count, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Visible blocks change as the camera moves, so Three's cached instance
  // bounds would go stale. Bound the entire pilot area once instead.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0),
    (CENTER_LIMIT + BLOCK_WIDTH / 2) * Math.SQRT2 + 3);
  mesh.count = 0;
  return mesh;
}

function updateMatrices(mesh, count) {
  mesh.count = count;
  mesh.visible = count > 0;
  if (!count) return;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * 16);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.clearUpdateRanges();
  mesh.instanceColor.addUpdateRange(0, count * 3);
  mesh.instanceColor.needsUpdate = true;
}

export function createPedestrians(scene, cityBlocks) {
  const random = rng(0x53d1c);
  const blocks = cityBlocks.filter(({ x0, z0 }) => Math.max(
    Math.abs(x0 + BLOCK_WIDTH / 2), Math.abs(z0 + BLOCK_WIDTH / 2)) <= CENTER_LIMIT);
  const groups = blocks.map((block) => ({
    block,
    bounds: new THREE.Sphere(new THREE.Vector3(block.x0 + BLOCK_WIDTH / 2, 1, block.z0 + BLOCK_WIDTH / 2), BLOCK_WIDTH * 0.72),
    people: Array.from({ length: block.park ? 4 : 3 }, (_, i) => {
      const start = (i + random()) * SIDE_LENGTH;
      const direction = random() < 0.5 ? -1 : 1;
      const phase = random() * Math.PI * 2;
      const tone = 0.15 + random() * 0.40;
      return {
        start, offset: start, initialDirection: direction, direction, phase, panic: 0,
        speed: 1.3 + random() * 0.7, pace: 0, size: 0.86 + random() * 0.23,
        idle: i === 1, yaw: 0, turning: false,
        tone: new THREE.Color().setRGB(tone, tone, tone),
      };
    }),
  }));
  const total = groups.reduce((sum, group) => sum + group.people.length, 0);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  const torso = instanceMesh(torsoGeometry(), material, total, 'Sidewalk pedestrians');
  const limbShape = shadeFaces(new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0), 0.69);
  const limbs = instanceMesh(limbShape, material, total * LIMBS, 'Sidewalk pedestrian limbs');
  scene.add(torso, limbs);

  const point = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const backward = new THREE.Vector3();
  const flightStart = new THREE.Vector3();
  const flightDelta = new THREE.Vector3();
  const nearest = new THREE.Vector3();
  const sample = new THREE.Vector3();
  const root = new THREE.Object3D();
  const part = new THREE.Object3D();
  const worldMatrix = new THREE.Matrix4();
  const direction = new THREE.Vector3();
  let hasFlightStart = false;
  let flightLengthSq = 0;
  let timeSinceDraw = UPDATE_INTERVAL;

  function distanceToFlightSquared(target, dragonPosition) {
    nearest.copy(dragonPosition);
    if (flightLengthSq > 0) {
      const t = clamp(sample.subVectors(target, flightStart).dot(flightDelta) / flightLengthSq, 0, 1);
      nearest.copy(flightStart).addScaledVector(flightDelta, t);
    }
    return target.distanceToSquared(nearest);
  }

  function update(dt, camera, dragonPosition) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    const draw = (timeSinceDraw += step) >= UPDATE_INTERVAL;
    if (draw) timeSinceDraw %= UPDATE_INTERVAL;

    flightLengthSq = 0;
    if (dragonPosition && hasFlightStart) {
      flightDelta.subVectors(dragonPosition, flightStart);
      flightLengthSq = flightDelta.lengthSq();
      if (flightLengthSq > FLIGHT_RESET_DISTANCE ** 2) flightLengthSq = 0;
    }

    let count = 0;
    for (const group of groups) {
      const { block, bounds, people } = group;
      const nearCamera = bounds.center.distanceToSquared(camera.position) < VIEW_DISTANCE ** 2;
      const nearDragon = dragonPosition && distanceToFlightSquared(bounds.center, dragonPosition) <
        (bounds.radius + SCARE_DISTANCE) ** 2;
      if (!nearCamera && !nearDragon) continue;
      for (const person of people) {
        sidewalkPoint(block, person.offset, point);
        if (nearDragon && distanceToFlightSquared(point, dragonPosition) < SCARE_DISTANCE ** 2) {
          if (person.panic <= 0) {
            sidewalkPoint(block, person.offset + 7, forward);
            sidewalkPoint(block, person.offset - 7, backward);
            person.direction = forward.distanceToSquared(nearest) > backward.distanceToSquared(nearest) ? 1 : -1;
          }
          person.panic = 2.3;
        }
        person.panic = Math.max(0, person.panic - step);
        const running = person.panic > 0;
        const targetPace = running ? 5.7 : person.idle ? 0 : person.speed;
        person.pace += (targetPace - person.pace) * (1 - Math.exp(-5 * step));
        person.offset = THREE.MathUtils.euclideanModulo(person.offset + person.direction * person.pace * step, ROUTE_LENGTH);
        person.phase = (person.phase + step * (2.2 + person.pace * 2.2)) % (Math.PI * 2);
        if (!draw || !nearCamera) continue;

        sidewalkPoint(block, person.offset, point);
        sidewalkPoint(block, person.offset + person.direction * 0.4, forward);
        direction.subVectors(forward, point);
        const targetYaw = Math.atan2(direction.x, direction.z);
        const turn = THREE.MathUtils.euclideanModulo(targetYaw - person.yaw + Math.PI, 2 * Math.PI) - Math.PI;
        person.yaw = person.turning ? person.yaw + turn * 0.35 : targetYaw;
        person.turning = true;
        const pace = Math.min(person.pace / 5.7, 1);
        const swing = Math.sin(person.phase) * Math.min(person.pace * 0.18, 0.84);
        const hip = 0.85 * Math.cos(swing) + Math.abs(Math.sin(person.phase)) * 0.07 * pace;
        root.position.copy(point);
        root.rotation.y = person.yaw;
        root.scale.setScalar(person.size);
        root.updateMatrix();

        part.position.set(0, hip - 0.02 + Math.sin(person.phase) * 0.012, 0);
        part.rotation.set(pace * 0.25, 0, swing * 0.10);
        part.scale.setScalar(1);
        part.updateMatrix();
        torso.setMatrixAt(count, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
        torso.setColorAt(count, person.tone);

        for (let side = 0; side < 2; side++) {
          const sign = side === 0 ? -1 : 1;
          const stride = swing * sign;
          const index = count * LIMBS + side * 2;
          part.position.set(sign * 0.13, hip, 0);
          part.rotation.set(stride, 0, 0);
          part.scale.set(0.18, 0.85, 0.19);
          part.updateMatrix();
          limbs.setMatrixAt(index, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
          part.position.set(sign * 0.31, hip + 0.45, pace * 0.12);
          part.rotation.set(-stride + pace * 0.37, 0, sign * 0.13);
          part.scale.set(0.13, 0.52, 0.14);
          part.updateMatrix();
          limbs.setMatrixAt(index + 1, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
          limbs.setColorAt(index, person.tone);
          limbs.setColorAt(index + 1, person.tone);
        }
        count++;
      }
    }

    hasFlightStart = !!dragonPosition;
    if (dragonPosition) flightStart.copy(dragonPosition);
    if (draw) {
      updateMatrices(torso, count);
      updateMatrices(limbs, count * LIMBS);
    }
  }

  function reset() {
    hasFlightStart = false;
    timeSinceDraw = UPDATE_INTERVAL;
    for (const { people } of groups) for (const person of people) {
      person.offset = person.start;
      person.direction = person.initialDirection;
      person.pace = 0;
      person.panic = 0;
      person.turning = false;
    }
  }

  return { update, reset };
}
