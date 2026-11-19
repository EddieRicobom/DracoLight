import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { ZODIAC_ANIMALS } from './zodiac-species.js';

// Dimensions are half axes. All animals face +Z with their feet at ground level.
const QUADRUPEDS = {
  rat: {
    colors: [0x798095, 0xbec4d6, 0xde9ca4],
    body: [0.4, 0.36, 0.68], head: [0.33, 0.31, 0.32], headAt: [0.91, 0.62],
    legs: [0.26, 0.48, 0.42, -0.44, 0.1], gait: 'trot',
    tail: [[0, 0, 0], [0, -0.08, -0.36], [0.16, -0.16, -0.68], [0.32, -0.04, -0.93]],
  },
  ox: {
    colors: [0x704535, 0xc29978, 0x45352d],
    body: [0.6, 0.55, 0.81], head: [0.43, 0.43, 0.35], headAt: [1.49, 0.78],
    legs: [0.38, 0.75, 0.5, -0.5, 0.17], gait: 'trot',
    tail: [[0, 0, 0], [0, -0.25, -0.24], [0.05, -0.55, -0.29]],
  },
  tiger: {
    colors: [0xe29a3e, 0xf5e1b6, 0x463229],
    body: [0.45, 0.43, 0.78], head: [0.4, 0.39, 0.38], headAt: [1.23, 0.79],
    legs: [0.29, 0.68, 0.5, -0.51, 0.13], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.1, -0.38], [0.13, 0.3, -0.66], [0.24, 0.56, -0.77]],
  },
  rabbit: {
    colors: [0xb9a6b3, 0xf1dde0, 0xd893a6],
    body: [0.42, 0.4, 0.54], head: [0.36, 0.37, 0.34], headAt: [1.06, 0.45],
    legs: [0.27, 0.49, 0.39, -0.37, 0.12], gait: 'bound',
  },
  horse: {
    colors: [0xa15d42, 0xe7b990, 0x443132],
    body: [0.49, 0.53, 0.82], head: [0.29, 0.29, 0.49], headAt: [1.98, 0.85],
    legs: [0.31, 1.0, 0.54, -0.53, 0.115], gait: 'gallop',
    tail: [[0, 0, 0], [0, -0.08, -0.24], [0.06, -0.39, -0.41], [0.03, -0.69, -0.49]],
  },
  goat: {
    colors: [0xd4c5ad, 0xf3e6cf, 0x625449],
    body: [0.4, 0.42, 0.65], head: [0.31, 0.34, 0.31], headAt: [1.46, 0.67],
    legs: [0.26, 0.72, 0.42, -0.48, 0.1], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.21, -0.25], [0, 0.28, -0.35]],
  },
  dog: {
    colors: [0xbe8654, 0xf5dbb9, 0x694739],
    body: [0.44, 0.42, 0.65], head: [0.39, 0.35, 0.34], headAt: [1.27, 0.64],
    legs: [0.27, 0.67, 0.41, -0.43, 0.135], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.24, -0.25], [0.06, 0.53, -0.36], [0.15, 0.63, -0.28]],
  },
  pig: {
    colors: [0xe2a0a2, 0xf5c9be, 0xb96f7e],
    body: [0.55, 0.46, 0.7], head: [0.43, 0.37, 0.37], headAt: [1.0, 0.63],
    legs: [0.34, 0.49, 0.46, -0.47, 0.135], gait: 'trot',
    tail: [[0, 0, 0], [0, 0.03, -0.2], [0, 0.22, -0.31], [0, 0.33, -0.24], [0.02, 0.23, -0.16]],
  },
};

const EYE = 0x211c24;
const GLINT = 0xfff5de;
const IVORY = 0xf4deae;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const V = (point) => new THREE.Vector3(...point);

function tint(shape, color) {
  shape.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const values = new Float32Array(shape.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) c.toArray(values, i);
  shape.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return shape;
}

function ellipsoid(color, position, axes, tilt = 0, pitch = 0) {
  return tint(new THREE.SphereGeometry(1, 9, 6)
    .scale(...axes).rotateX(pitch).rotateZ(tilt).translate(...position), color);
}

function segment(color, start, end, startRadius, endRadius) {
  const origin = V(start);
  const delta = V(end).sub(origin);
  const geometry = new THREE.CylinderGeometry(endRadius, startRadius, delta.length(), 7);
  const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, delta.clone().normalize());
  geometry.applyQuaternion(rotation).translate(...origin.addScaledVector(delta, 0.5).toArray());
  return tint(geometry, color);
}

function chain(parts, color, points, radii) {
  for (let i = 1; i < points.length; i++) {
    parts.push(segment(color, points[i - 1], points[i], radii[i - 1], radii[i]));
    if (i < points.length - 1) {
      parts.push(ellipsoid(color, points[i], [radii[i], radii[i], radii[i]]));
    }
  }
}

function attach(parent, parts, material) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function pivot(parent, position) {
  const child = new THREE.Group();
  child.position.set(...position);
  parent.add(child);
  return child;
}

function eye(parts, x, y, z, size = 0.066) {
  const sign = Math.sign(x);
  parts.push(
    ellipsoid(EYE, [x, y, z], [size * 0.8, size, size * 0.72]),
    ellipsoid(GLINT, [x + sign * size * 0.38, y + size * 0.31, z + size * 0.56], [size * 0.25, size * 0.26, size * 0.23]),
  );
}

function muzzle(parts, color, width, length, noseColor = EYE, y = -0.12) {
  parts.push(
    ellipsoid(color, [0, y, 0.26], [width, width * 0.65, length]),
    ellipsoid(noseColor, [0, y + width * 0.18, 0.23 + length], [width * 0.38, width * 0.29, 0.044]),
  );
}

function quadrupedHead(id, { colors: [base, light, dark], head: [w, h, d] }) {
  const parts = [ellipsoid(base, [0, 0, 0], [w, h, d])];
  const ears = (x, y, earWidth, earHeight, tilt) => {
    for (const side of [-1, 1]) {
      parts.push(
        ellipsoid(base, [x * side, y, -0.02], [earWidth, earHeight, earWidth * 0.54], tilt * side),
        ellipsoid(dark, [x * side, y + 0.02, earWidth * 0.42], [earWidth * 0.7, earHeight * 0.76, earWidth * 0.19], tilt * side),
      );
    }
  };
  for (const side of [-1, 1]) eye(parts, side * w * 0.77, h * 0.18, d * 0.64);

  switch (id) {
    case 'rat':
      ears(0.25, 0.25, 0.15, 0.17, -0.28);
      muzzle(parts, light, 0.15, 0.23, dark);
      parts.push(ellipsoid(IVORY, [0, -0.21, 0.42], [0.045, 0.075, 0.035]));
      break;
    case 'ox':
      muzzle(parts, light, 0.33, 0.27, dark, -0.19);
      for (const side of [-1, 1]) {
        parts.push(ellipsoid(dark, [side * 0.42, 0.14, 0.02], [0.21, 0.08, 0.11], side * -0.15));
        chain(parts, IVORY, [[side * 0.28, 0.29, 0], [side * 0.54, 0.41, -0.02], [side * 0.62, 0.66, 0.03]], [0.105, 0.07, 0.005]);
      }
      break;
    case 'tiger':
      ears(0.29, 0.28, 0.12, 0.13, -0.32);
      muzzle(parts, light, 0.27, 0.25);
      for (const side of [-1, 1]) {
        parts.push(
          ellipsoid(dark, [side * 0.21, 0.29, 0.2], [0.035, 0.16, 0.033], side * 0.68),
          ellipsoid(dark, [side * 0.34, -0.04, 0.15], [0.04, 0.04, 0.14]),
        );
      }
      break;
    case 'rabbit':
      ears(0.17, 0.57, 0.12, 0.43, -0.18);
      muzzle(parts, light, 0.19, 0.17, dark);
      parts.push(ellipsoid(IVORY, [0, -0.25, 0.36], [0.055, 0.055, 0.035]));
      break;
    case 'horse':
      ears(0.19, 0.27, 0.085, 0.2, -0.12);
      muzzle(parts, dark, 0.22, 0.29, light, -0.16);
      parts.push(
        ellipsoid(light, [0, 0.12, 0.4], [0.074, 0.13, 0.036]),
        ellipsoid(dark, [0, 0.3, -0.02], [0.21, 0.14, 0.24], -0.2),
      );
      break;
    case 'goat':
      muzzle(parts, light, 0.19, 0.2, dark);
      for (const side of [-1, 1]) {
        parts.push(ellipsoid(light, [side * 0.33, 0.07, -0.02], [0.17, 0.08, 0.09], side * 0.24));
        chain(parts, dark, [[side * 0.16, 0.27, -0.03], [side * 0.23, 0.53, -0.15], [side * 0.22, 0.66, -0.28]], [0.075, 0.045, 0.005]);
      }
      parts.push(ellipsoid(light, [0, -0.34, 0.2], [0.11, 0.2, 0.105], 0, -0.24));
      break;
    case 'dog':
      muzzle(parts, light, 0.235, 0.24);
      for (const side of [-1, 1]) {
        parts.push(ellipsoid(dark, [side * 0.34, -0.03, -0.08], [0.15, 0.3, 0.14], side * 0.24, -0.38));
      }
      parts.push(ellipsoid(light, [0, 0.11, 0.29], [0.06, 0.16, 0.04]));
      break;
    case 'pig':
      for (const side of [-1, 1]) {
        parts.push(
          segment(base, [side * 0.25, 0.22, -0.05], [side * 0.39, 0.55, -0.09], 0.135, 0.02),
          ellipsoid(dark, [side * 0.31, 0.32, 0.035], [0.06, 0.14, 0.024], side * -0.32),
          ellipsoid(dark, [side * 0.08, -0.09, 0.557], [0.04, 0.05, 0.025]),
        );
      }
      parts.push(ellipsoid(light, [0, -0.12, 0.39], [0.255, 0.19, 0.178]));
      break;
  }
  return parts;
}

function quadruped(body, material, id, definition) {
  const { colors: [base, light, dark], headAt: [headY, headZ], legs: [legX, legY, frontZ, rearZ, legWidth] } = definition;
  const hooves = id === 'ox' || id === 'horse' || id === 'goat' || id === 'pig';
  const bodyY = legY + 0.17;
  const hull = [
    ellipsoid(base, [0, bodyY, 0], definition.body),
    ellipsoid(light, [0, bodyY - 0.18, 0.16], [definition.body[0] * 0.76, definition.body[1] * 0.77, definition.body[2] * 0.77]),
    segment(base, [0, bodyY, frontZ], [0, headY, headZ], definition.body[0] * 0.75, definition.head[0] * 0.7),
  ];
  if (id === 'tiger') {
    for (const z of [-0.48, -0.22, 0.08, 0.36]) {
      const width = definition.body[0] * Math.sqrt(1 - (z / definition.body[2]) ** 2);
      hull.push(ellipsoid(dark, [0, bodyY + 0.065, z], [width * 1.025, 0.43 * width / definition.body[0], 0.055], 0, -0.28));
    }
  } else if (id === 'horse') {
    hull.push(ellipsoid(dark, [0, 1.62, 0.48], [0.18, 0.52, 0.16], 0, 0.5));
  }
  attach(body, hull, material);
  const head = pivot(body, [0, headY, headZ]);
  attach(head, quadrupedHead(id, definition), material);
  const legs = [];
  for (const [index, z] of [frontZ, rearZ].entries()) {
    const rear = index === 1;
    for (const side of [-1, 1]) {
      const leg = pivot(body, [side * legX, legY, z]);
      const thick = rear && id === 'rabbit' ? legWidth * 1.57 : legWidth;
      attach(leg, [
        segment(base, [0, 0.07, 0], [0, -legY + 0.07, 0], thick, legWidth * 0.72),
        ellipsoid(hooves ? dark : light, [0, -legY + 0.085, 0.047], [thick, 0.085, thick * 1.47]),
      ], material);
      legs.push({ joint: leg, side, rear });
    }
  }
  const tail = pivot(body, [0, bodyY + 0.14, -definition.body[2] * 0.83]);
  if (definition.tail) {
    const parts = [];
    const radius = id === 'horse' ? 0.14 : id === 'tiger' || id === 'dog' ? 0.097 : 0.055;
    const tailColor = id === 'rat' || id === 'pig' || id === 'horse' ? dark : base;
    chain(parts, tailColor, definition.tail, definition.tail.map((_, i) => radius * (1 - i / definition.tail.length)));
    if (id === 'ox' || id === 'tiger') parts.push(ellipsoid(dark, definition.tail.at(-1), [radius * 1.3, radius * 1.65, radius * 1.3]));
    attach(tail, parts, material);
  } else {
    attach(tail, [ellipsoid(light, [0, 0.07, -0.12], [0.15, 0.15, 0.17])], material);
  }
  return { head, legs, tail, gait: definition.gait };
}

function monkey(body, material) {
  const fur = 0x865040;
  const face = 0xe1ab7d;
  const dark = 0x563428;
  attach(body, [
    ellipsoid(fur, [0, 1.03, 0], [0.365, 0.52, 0.32]),
    ellipsoid(face, [0, 1.01, 0.21], [0.26, 0.35, 0.15]),
  ], material);
  const head = pivot(body, [0, 1.59, 0.045]);
  const skull = [
    ellipsoid(fur, [0, 0, 0], [0.42, 0.37, 0.36]),
    ellipsoid(face, [0, -0.02, 0.25], [0.29, 0.26, 0.16]),
    ellipsoid(0xd29870, [0, -0.12, 0.33], [0.2, 0.135, 0.13]),
    ellipsoid(dark, [0, -0.055, 0.452], [0.047, 0.029, 0.027]),
  ];
  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    skull.push(
      ellipsoid(fur, [side * 0.41, 0.03, 0], [0.14, 0.157, 0.11]),
      ellipsoid(face, [side * 0.43, 0.03, 0.075], [0.102, 0.106, 0.052]),
    );
    eye(skull, side * 0.147, 0.045, 0.395);
    const arm = pivot(body, [side * 0.32, 1.29, 0]);
    attach(arm, [
      segment(fur, [0, 0.04, 0], [side * 0.16, -0.59, 0.08], 0.14, 0.085),
      ellipsoid(face, [side * 0.16, -0.62, 0.08], [0.105, 0.146, 0.11]),
    ], material);
    arms.push({ joint: arm, side });
    const leg = pivot(body, [side * 0.18, 0.75, 0]);
    attach(leg, [
      segment(fur, [0, 0.02, 0], [side * 0.035, -0.64, 0], 0.13, 0.084),
      ellipsoid(dark, [side * 0.035, -0.66, 0.074], [0.12, 0.09, 0.16]),
    ], material);
    legs.push({ joint: leg, side });
  }
  attach(head, skull, material);
  const tail = pivot(body, [0, 0.82, -0.24]);
  const curl = [];
  chain(curl, fur, [[0, 0, 0], [0, 0.02, -0.3], [0.07, 0.28, -0.57], [0.1, 0.64, -0.61], [0.06, 0.81, -0.47]], [0.084, 0.07, 0.06, 0.052, 0.026]);
  attach(tail, curl, material);
  return { head, legs, arms, tail, gait: 'biped' };
}

function rooster(body, material) {
  const plumage = 0x9f593b;
  const chest = 0xe4a24b;
  const tailColor = 0x344842;
  const comb = 0xd54a43;
  const beak = 0xe3b34a;
  const head = pivot(body, [0, 1.55, 0.43]);
  const crown = [
    ellipsoid(chest, [0, 0, 0], [0.27, 0.29, 0.28]),
    segment(beak, [0, -0.025, 0.21], [0, -0.07, 0.49], 0.13, 0.008),
    ellipsoid(comb, [0, -0.22, 0.19], [0.078, 0.15, 0.088]),
  ];
  for (const z of [-0.16, 0.01, 0.15]) {
    crown.push(ellipsoid(comb, [0, 0.29, z], [0.085, z === 0.01 ? 0.18 : 0.135, 0.105], 0, -0.23));
  }
  attach(body, [
    ellipsoid(plumage, [0, 0.92, 0], [0.4, 0.42, 0.55]),
    ellipsoid(chest, [0, 1.17, 0.34], [0.29, 0.53, 0.29], 0, 0.26),
  ], material);
  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    eye(crown, side * 0.21, 0.065, 0.16, 0.058);
    const wing = pivot(body, [side * 0.32, 1.01, 0.13]);
    attach(wing, [
      ellipsoid(plumage, [side * 0.25, -0.04, 0], [0.33, 0.15, 0.17], side * -0.18),
      ellipsoid(tailColor, [side * 0.51, -0.08, -0.065], [0.26, 0.065, 0.14], side * -0.18),
      ellipsoid(tailColor, [side * 0.44, -0.09, -0.18], [0.24, 0.06, 0.11], side * -0.18),
    ], material);
    wing.rotation.y = side * 1.31;
    arms.push({ joint: wing, side });
    const leg = pivot(body, [side * 0.19, 0.71, 0.07]);
    const foot = [0, -0.663, 0.062];
    const pieces = [segment(beak, [0, 0, 0], foot, 0.067, 0.042)];
    for (const toeX of [-0.095, 0, 0.095]) pieces.push(segment(beak, foot, [toeX, -0.685, 0.24], 0.042, 0.018));
    attach(leg, pieces, material);
    legs.push({ joint: leg, side });
  }
  attach(head, crown, material);
  const tail = pivot(body, [0, 1.02, -0.4]);
  const feathers = [];
  for (const dx of [-0.17, 0, 0.17]) {
    chain(feathers, tailColor, [[0, 0, 0], [dx, 0.39, -0.29], [dx * 1.25, 0.43, -0.65], [dx * 1.4, 0.18, -0.88]], [0.093, 0.109, 0.085, 0.006]);
  }
  attach(tail, feathers, material);
  return { head, legs, arms, tail, gait: 'bird' };
}

function snake(body, material) {
  const back = 0x497959;
  const belly = 0xecd29a;
  const hood = 0x71a478;
  const bodyParts = [];
  const points = [[0.47, 0.12, -0.63], [0.03, 0.14, -0.85], [-0.5, 0.15, -0.61], [-0.43, 0.2, -0.15]];
  chain(bodyParts, back, points, [0.013, 0.08, 0.125, 0.16]);
  bodyParts.push(ellipsoid(back, points.at(-1), [0.16, 0.16, 0.16]));
  attach(body, bodyParts, material);

  const neck = pivot(body, points.at(-1));
  attach(neck, [
    segment(back, [0, 0, 0], [0.36, 0.29, 0.34], 0.16, 0.185),
    ellipsoid(back, [0.36, 0.35, 0.36], [0.21, 0.34, 0.2]),
    ellipsoid(belly, [0.37, 0.37, 0.46], [0.145, 0.23, 0.12]),
  ], material);
  const head = pivot(neck, [0.38, 0.63, 0.31]);
  const crown = [
    ellipsoid(back, [0, 0.12, 0.14], [0.29, 0.21, 0.35]),
    ellipsoid(belly, [0, -0.01, 0.24], [0.22, 0.1, 0.27]),
    ellipsoid(EYE, [0, -0.012, 0.48], [0.11, 0.021, 0.022]),
  ];
  for (const side of [-1, 1]) {
    crown.push(
      ellipsoid(hood, [side * 0.23, -0.13, -0.01], [0.22, 0.42, 0.105], side * -0.41),
      ellipsoid(belly, [side * 0.277, -0.12, 0.072], [0.102, 0.27, 0.054], side * -0.41),
    );
    eye(crown, side * 0.207, 0.165, 0.354, 0.067);
  }
  attach(head, crown, material);
  return { head, neck, legs: [], gait: 'slither' };
}

const BUILDERS = { monkey, rooster, snake };

/** Build a low-poly visual rig. Movement, collision and networking stay with the player controller. */
export function createZodiacAvatar(id, { height = 3.4 } = {}) {
  const definition = Object.hasOwn(QUADRUPEDS, id) ? QUADRUPEDS[id] : null;
  const build = Object.hasOwn(BUILDERS, id) ? BUILDERS[id] : null;
  if (!definition && !build) throw new RangeError(`Unknown zodiac animal: ${id}`);
  const root = new THREE.Group();
  root.name = `Zodiac: ${id}`;
  const body = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.87 });
  root.add(body);
  const rig = definition ? quadruped(body, material, id, definition) : build(body, material);
  const bounds = new THREE.Box3().setFromObject(body);
  const scale = height / (bounds.max.y - bounds.min.y);
  root.scale.setScalar(scale);
  const floor = -bounds.min.y;
  body.position.y = floor;
  let phase = 0;

  function animate(dt, { state = 'idle', speed = 0, verticalSpeed = 0, ability = '' } = {}) {
    const climbing = state === 'climb';
    const moving = state === 'walk' || state === 'run' || climbing;
    const airborne = state === 'air';
    const energetic = state === 'run' || Boolean(ability);
    phase += dt * (moving ? 4 + Math.min(Math.abs(speed), 55) * 0.34 : 3.5);
    const wave = Math.sin(phase);
    const stride = moving ? (energetic ? 0.63 : 0.38) : 0;
    const lift = moving ? Math.abs(wave) * (rig.gait === 'bound' ? 0.13 : 0.065) : 0;
    body.position.y = floor + lift;
    body.rotation.x = airborne ? -THREE.MathUtils.clamp(verticalSpeed * 0.027, -0.3, 0.3) : -wave * stride * 0.1;
    if (climbing) body.rotation.x -= ability && id === 'goat' ? 0.26 : 0.15;
    if (ability && id === 'ox') body.rotation.x += 0.13;
    rig.head.rotation.x = airborne ? body.rotation.x * -0.45 : Math.sin(phase * 0.5) * 0.048;
    if (ability && id === 'ox') rig.head.rotation.x += 0.22;
    if (ability && id === 'dog') rig.head.rotation.x += 0.31;
    for (const { joint, side, rear } of rig.legs) {
      let offset = side < 0 ? Math.PI : 0;
      if (rig.gait === 'bound' && energetic) offset = rear ? Math.PI : 0;
      else if (rig.gait === 'gallop' && energetic) offset = (rear ? Math.PI : 0) + side * 0.55;
      else if (rear) offset += Math.PI;
      joint.rotation.x = airborne ? (rear ? 0.54 : -0.54) : Math.sin(phase + offset) * stride;
    }
    for (const { joint, side } of rig.arms ?? []) {
      if (rig.gait === 'bird') {
        const spread = airborne || Boolean(ability);
        joint.rotation.y = side * (spread ? 0.18 : 1.31);
        joint.rotation.z = side * (spread ? -0.04 + wave * (ability ? 0.13 : 0.32) : wave * stride * 0.25);
      } else {
        joint.rotation.x = airborne ? -0.8 : -wave * stride * side;
      }
    }
    if (rig.tail) rig.tail.rotation.y = Math.sin(phase * 0.85) * (moving ? 0.25 : 0.095);
    if (rig.neck) {
      rig.neck.rotation.y = wave * (moving ? 0.44 : 0.085);
      rig.head.rotation.y = rig.neck.rotation.y * -0.7;
      body.position.x = wave * stride * 0.12;
    }
  }

  function dispose() {
    root.removeFromParent();
    root.traverse((object) => {
      if (object.isMesh) object.geometry.dispose();
    });
    material.dispose();
  }

  return { root, animate, dispose };
}
