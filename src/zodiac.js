import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { ZODIAC_ANIMALS } from './zodiac-species.js';

// Dimensions are half axes. All animals face +Z with their feet at ground level.
const QUADRUPEDS = {
  rat: {
    colors: [0x798197, 0xc6ccdb, 0xd993a0],
    body: [0.38, 0.37, 0.61], head: [0.29, 0.29, 0.36], headAt: [0.91, 0.53],
    legs: [0.24, 0.45, 0.35, -0.38, 0.09], gait: 'trot',
    tail: [[0, 0, 0], [0, -0.16, -0.23], [0.13, -0.22, -0.49], [0.35, -0.13, -0.67], [0.47, 0.02, -0.7]],
  },
  ox: {
    colors: [0x704535, 0xc29978, 0x45352d],
    body: [0.65, 0.52, 0.83], head: [0.48, 0.38, 0.35], headAt: [1.36, 0.8],
    legs: [0.41, 0.67, 0.51, -0.53, 0.18], gait: 'trot',
    tail: [[0, 0, 0], [0, -0.25, -0.24], [0.05, -0.55, -0.29]],
  },
  tiger: {
    colors: [0xe29a3e, 0xf5e1b6, 0x463229],
    body: [0.46, 0.41, 0.82], head: [0.38, 0.34, 0.39], headAt: [1.12, 0.81],
    legs: [0.29, 0.62, 0.54, -0.51, 0.15], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.1, -0.38], [0.13, 0.3, -0.66], [0.24, 0.56, -0.77]],
  },
  rabbit: {
    colors: [0xb9a6b3, 0xf1dde0, 0xd893a6],
    body: [0.46, 0.45, 0.55], head: [0.34, 0.35, 0.32], headAt: [1.07, 0.43],
    legs: [0.27, 0.49, 0.39, -0.37, 0.12], gait: 'bound',
  },
  horse: {
    colors: [0xa15d42, 0xe7b990, 0x443132],
    body: [0.47, 0.44, 0.81], head: [0.27, 0.29, 0.47], headAt: [2.02, 0.87],
    legs: [0.31, 1.1, 0.55, -0.54, 0.11], gait: 'gallop',
    tail: [[0, 0, 0], [0, -0.08, -0.24], [0.06, -0.39, -0.41], [0.03, -0.69, -0.49]],
  },
  goat: {
    colors: [0xd4c5ad, 0xf3e6cf, 0x625449],
    body: [0.39, 0.4, 0.65], head: [0.28, 0.32, 0.36], headAt: [1.43, 0.64],
    legs: [0.26, 0.72, 0.42, -0.48, 0.1], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.21, -0.25], [0, 0.28, -0.35]],
  },
  dog: {
    colors: [0xb87d4f, 0xf5dbb9, 0x52382f],
    body: [0.43, 0.41, 0.65], head: [0.37, 0.35, 0.34], headAt: [1.27, 0.62],
    legs: [0.27, 0.67, 0.41, -0.43, 0.135], gait: 'bound',
    tail: [[0, 0, 0], [0, 0.24, -0.25], [0.06, 0.53, -0.36], [0.15, 0.63, -0.28]],
  },
  pig: {
    colors: [0xe2a0a2, 0xf5c9be, 0xb96f7e],
    body: [0.61, 0.49, 0.69], head: [0.43, 0.35, 0.37], headAt: [0.96, 0.61],
    legs: [0.36, 0.42, 0.42, -0.43, 0.14], gait: 'trot',
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

function ellipsoid(color, position, axes, tilt = 0, pitch = 0, detail = 9) {
  const shape = tint(new THREE.SphereGeometry(1, detail, Math.ceil(detail * 2 / 3)), color);
  const colors = shape.getAttribute('color');
  const vertices = shape.getAttribute('position');
  for (let i = 0; i < colors.count; i++) {
    const shade = 0.9 + vertices.getY(i) * 0.1;
    colors.setXYZ(i, colors.getX(i) * shade, colors.getY(i) * shade, colors.getZ(i) * shade);
  }
  return shape.scale(...axes).rotateX(pitch).rotateZ(tilt).translate(...position);
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
      parts.push(ellipsoid(color, points[i], [radii[i], radii[i], radii[i]], 0, 0, 6));
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
    ellipsoid(GLINT, [x + sign * size * 0.38, y + size * 0.31, z + size * 0.56], [size * 0.25, size * 0.26, size * 0.23], 0, 0, 6),
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
  for (const side of [-1, 1]) {
    const x = side * w * 0.77;
    const y = h * 0.18;
    const z = d * 0.64;
    if (id === 'goat') {
      parts.push(
        ellipsoid(0xcd9d47, [x, y, z], [0.058, 0.053, 0.051]),
        ellipsoid(EYE, [x + side * 0.025, y, z + 0.04], [0.037, 0.016, 0.017], 0, 0, 6),
      );
    } else {
      eye(parts, x, y, z);
    }
  }

  switch (id) {
    case 'rat':
      ears(0.245, 0.275, 0.19, 0.215, -0.28);
      muzzle(parts, light, 0.145, 0.25, dark);
      for (const side of [-1, 1]) {
        parts.push(
          ellipsoid(IVORY, [side * 0.032, -0.21, 0.44], [0.03, 0.062, 0.03], 0, 0, 6),
          segment(light, [side * 0.105, -0.1, 0.4], [side * 0.34, -0.075, 0.44], 0.021, 0.007),
          segment(light, [side * 0.12, -0.126, 0.39], [side * 0.31, -0.158, 0.46], 0.015, 0.005),
        );
      }
      break;
    case 'ox':
      parts.push(
        ellipsoid(light, [0, -0.18, 0.29], [0.39, 0.19, 0.255]),
        ellipsoid(dark, [0, 0.302, 0.22], [0.19, 0.095, 0.18], 0, 0.44, 7),
      );
      for (const side of [-1, 1]) {
        parts.push(
          ellipsoid(dark, [side * 0.46, 0.08, -0.03], [0.23, 0.09, 0.12], side * -0.15),
          ellipsoid(dark, [side * 0.196, -0.14, 0.511], [0.057, 0.039, 0.029], side * 0.28, 0, 6),
        );
        chain(parts, IVORY, [[side * 0.31, 0.23, -0.055], [side * 0.63, 0.31, -0.04], [side * 0.81, 0.58, 0.09]], [0.115, 0.078, 0.008]);
      }
      break;
    case 'tiger':
      ears(0.275, 0.235, 0.135, 0.14, -0.32);
      muzzle(parts, light, 0.25, 0.28);
      for (const side of [-1, 1]) {
        parts.push(
          ellipsoid(light, [side * 0.26, -0.13, 0.14], [0.18, 0.15, 0.205], side * 0.5),
          ellipsoid(dark, [side * 0.21, 0.29, 0.2], [0.035, 0.16, 0.033], side * 0.68),
          ellipsoid(dark, [side * 0.35, -0.09, 0.19], [0.055, 0.037, 0.145], side * 0.51, -0.22, 6),
        );
      }
      break;
    case 'rabbit':
      for (const side of [-1, 1]) {
        const y = side < 0 ? 0.63 : 0.57;
        const tilt = side < 0 ? 0.14 : -0.35;
        parts.push(
          ellipsoid(base, [side * 0.18, y, -0.04], [0.13, 0.47, 0.101], tilt, -0.13),
          ellipsoid(dark, [side * 0.18, y + 0.018, 0.055], [0.082, 0.355, 0.033], tilt, -0.13),
        );
      }
      muzzle(parts, light, 0.19, 0.17, dark);
      parts.push(ellipsoid(IVORY, [0, -0.25, 0.36], [0.055, 0.055, 0.035]));
      for (const side of [-1, 1]) {
        parts.push(ellipsoid(light, [side * 0.233, -0.151, 0.202], [0.116, 0.116, 0.13], side * 0.32, 0, 7));
      }
      break;
    case 'horse':
      ears(0.178, 0.26, 0.084, 0.205, -0.12);
      parts.push(
        ellipsoid(base, [0, -0.11, 0.34], [0.23, 0.2, 0.33], 0, 0.4),
        ellipsoid(dark, [0, -0.185, 0.52], [0.208, 0.14, 0.16]),
        ellipsoid(light, [0, 0.125, 0.395], [0.072, 0.13, 0.07], -0.12, 0.3, 6),
        ellipsoid(dark, [0.035, 0.25, 0.19], [0.16, 0.14, 0.27], 0.34, 0.26),
      );
      break;
    case 'goat':
      muzzle(parts, light, 0.19, 0.2, dark);
      for (const side of [-1, 1]) {
        parts.push(ellipsoid(light, [side * 0.33, 0.07, -0.02], [0.17, 0.08, 0.09], side * 0.24));
        chain(parts, dark, [[side * 0.155, 0.235, -0.04], [side * 0.21, 0.53, -0.11], [side * 0.26, 0.71, -0.29], [side * 0.235, 0.69, -0.48]], [0.087, 0.069, 0.047, 0.007]);
      }
      parts.push(segment(light, [0, -0.21, 0.25], [0, -0.56, 0.29], 0.111, 0.013));
      break;
    case 'dog':
      muzzle(parts, light, 0.235, 0.24);
      for (const side of [-1, 1]) {
        parts.push(
          ellipsoid(dark, [side * 0.355, -0.065, -0.025], [0.14, 0.345, 0.145], side * 0.32, -0.31),
          ellipsoid(light, [side * 0.267, 0.146, 0.221], [0.063, 0.025, 0.033], side * -0.3, 0, 6),
        );
      }
      parts.push(ellipsoid(light, [0, 0.11, 0.29], [0.06, 0.16, 0.04]));
      break;
    case 'pig':
      for (const side of [-1, 1]) {
        parts.push(
          segment(base, [side * 0.25, 0.22, -0.05], [side * 0.39, 0.55, -0.09], 0.135, 0.02),
          ellipsoid(dark, [side * 0.31, 0.32, 0.035], [0.06, 0.14, 0.024], side * -0.32),
          ellipsoid(dark, [side * 0.08, -0.09, 0.557], [0.04, 0.05, 0.025]),
          ellipsoid(0xd7868c, [side * 0.326, -0.124, 0.231], [0.056, 0.071, 0.088], 0, 0, 6),
        );
      }
      parts.push(ellipsoid(light, [0, -0.13, 0.405], [0.267, 0.185, 0.166]));
      break;
  }
  return parts;
}

function tigerTorso(base, dark, center, axes) {
  const sides = 10;
  const rings = 15;
  const torso = tint(new THREE.SphereGeometry(1, sides, rings).rotateX(Math.PI / 2), base);
  const positions = torso.getAttribute('position');
  const colors = torso.getAttribute('color');
  const stripe = new THREE.Color(dark);
  for (let i = 0; i < positions.count; i++) {
    const ring = Math.floor(i / (sides + 1));
    const y = positions.getY(i);
    const stagger = positions.getX(i) < -0.46 ? 1 : 0;
    if (ring > 1 && (ring + stagger) % 4 === 0 && y > -0.24) colors.setXYZ(i, stripe.r, stripe.g, stripe.b);
  }
  return torso.scale(...axes).translate(0, center, 0);
}

function quadruped(body, material, id, definition) {
  const { colors: [base, light, dark], headAt: [headY, headZ], legs: [legX, legY, frontZ, rearZ, legWidth] } = definition;
  const hooves = id === 'ox' || id === 'horse' || id === 'goat' || id === 'pig';
  const bodyY = legY + 0.17;
  const hull = [
    id === 'tiger' ? tigerTorso(base, dark, bodyY, definition.body) : ellipsoid(base, [0, bodyY, 0], definition.body),
    ellipsoid(light, [0, bodyY - 0.18, 0.16], [definition.body[0] * 0.76, definition.body[1] * 0.77, definition.body[2] * 0.77]),
    segment(base, [0, bodyY, frontZ], [0, headY, headZ], definition.body[0] * 0.75, definition.head[0] * 0.7),
  ];
  if (id === 'ox') {
    hull.push(ellipsoid(base, [0, bodyY + 0.21, 0.27], [0.62, 0.47, 0.53], 0, 0.27));
  } else if (id === 'tiger') {
    hull.push(ellipsoid(light, [0, bodyY - 0.09, 0.65], [0.32, 0.29, 0.27]));
  } else if (id === 'horse') {
    hull.push(ellipsoid(base, [0, 1.57, 0.54], [0.29, 0.61, 0.29], 0, 0.38));
    chain(hull, dark, [[0, 2.12, 0.66], [0.045, 1.94, 0.41], [-0.055, 1.65, 0.24], [0.05, 1.49, 0.04]], [0.11, 0.172, 0.147, 0.023]);
    hull.push(ellipsoid(dark, [0.18, 1.76, 0.34], [0.08, 0.28, 0.13], 0.19, 0.43, 7));
  } else if (id === 'goat') {
    hull.push(ellipsoid(light, [0, bodyY - 0.03, 0.48], [0.25, 0.33, 0.22], 0, 0.19, 7));
  } else if (id === 'dog') {
    hull.push(ellipsoid(dark, [0, bodyY + 0.18, -0.17], [0.382, 0.266, 0.432], 0, 0.13));
  }
  attach(body, hull, material);
  const head = pivot(body, [0, headY, headZ]);
  attach(head, quadrupedHead(id, definition), material);
  const legs = [];
  for (const [index, z] of [frontZ, rearZ].entries()) {
    const rear = index === 1;
    for (const side of [-1, 1]) {
      const leg = pivot(body, [side * legX, legY, z]);
      const haunch = rear && id === 'rabbit';
      const ankle = [0, -legY + 0.085, haunch ? 0.12 : 0.03];
      const foot = [0, ankle[1], ankle[2] + 0.025];
      const parts = [ellipsoid(hooves ? dark : light, foot, [legWidth, 0.085, legWidth * (haunch ? 2.15 : 1.32)])];
      if (haunch) {
        parts.push(ellipsoid(base, [0, -0.05, -0.045], [0.22, 0.29, 0.22], 0, 0.28));
        parts.push(segment(base, [0, -0.14, -0.125], ankle, 0.125, 0.07));
      } else if (id === 'horse' || id === 'goat') {
        const knee = [0, -legY * 0.48, rear ? -0.15 : 0.03];
        parts.push(segment(base, [0, 0.13, 0], knee, legWidth * 1.32, legWidth * 0.71));
        parts.push(segment(dark, knee, ankle, legWidth * 0.72, legWidth * 0.74));
      } else {
        parts.push(segment(base, [0, 0.07, 0], ankle, legWidth, legWidth * 0.72));
      }
      attach(leg, parts, material);
      legs.push({ joint: leg, side, rear });
    }
  }
  const tail = pivot(body, [0, bodyY + 0.14, -definition.body[2] * 0.83]);
  if (definition.tail) {
    const parts = [];
    const radius = id === 'horse' ? 0.14 : id === 'tiger' || id === 'dog' ? 0.097 : 0.055;
    const tailColor = id === 'rat' || id === 'pig' || id === 'horse' ? dark : base;
    const radii = definition.tail.map((_, i) => radius * (1 - i / definition.tail.length));
    chain(parts, tailColor, definition.tail, radii);
    if (id === 'tiger') {
      for (let i = 1; i < definition.tail.length; i++) {
        const start = V(definition.tail[i - 1]);
        const end = V(definition.tail[i]);
        parts.push(segment(dark, start.clone().lerp(end, 0.38).toArray(), start.lerp(end, 0.62).toArray(),
          THREE.MathUtils.lerp(radii[i - 1], radii[i], 0.38) * 1.06,
          THREE.MathUtils.lerp(radii[i - 1], radii[i], 0.62) * 1.06));
      }
    }
    if (id === 'ox' || id === 'tiger') parts.push(ellipsoid(dark, definition.tail.at(-1), [radius * 1.3, radius * 1.65, radius * 1.3]));
    attach(tail, parts, material);
  } else {
    attach(tail, [ellipsoid(light, [0, 0.07, -0.12], [0.15, 0.15, 0.17])], material);
  }
  return { head, legs, tail, gait: definition.gait };
}

function monkey(body, material) {
  const fur = 0x935b44;
  const face = 0xe9b68f;
  const dark = 0x604034;
  attach(body, [
    ellipsoid(fur, [0, 1.02, 0], [0.355, 0.52, 0.32]),
    ellipsoid(face, [0, 1.01, 0.21], [0.26, 0.35, 0.15]),
  ], material);
  const head = pivot(body, [0, 1.59, 0.045]);
  const skull = [
    ellipsoid(fur, [0, 0, 0], [0.42, 0.37, 0.36]),
    ellipsoid(face, [0, -0.02, 0.25], [0.29, 0.26, 0.16]),
    ellipsoid(0xd29870, [0, -0.12, 0.33], [0.2, 0.135, 0.13]),
    ellipsoid(dark, [0, -0.055, 0.452], [0.047, 0.029, 0.027]),
    ellipsoid(dark, [0.06, 0.329, 0.092], [0.16, 0.115, 0.145], -0.38, -0.24, 6),
  ];
  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    skull.push(
      ellipsoid(fur, [side * 0.41, 0.03, 0], [0.14, 0.157, 0.11]),
      ellipsoid(face, [side * 0.43, 0.03, 0.075], [0.102, 0.106, 0.052]),
      ellipsoid(face, [side * 0.128, 0.112, 0.265], [0.131, 0.128, 0.134], side * 0.25, 0, 7),
    );
    eye(skull, side * 0.147, 0.045, 0.395);
    const arm = pivot(body, [side * 0.3, 1.31, 0]);
    const elbow = [side * 0.17, -0.39, -0.06];
    const wrist = [side * 0.21, -0.76, 0.12];
    attach(arm, [
      segment(fur, [0, 0.065, 0], elbow, 0.152, 0.102),
      segment(fur, elbow, wrist, 0.102, 0.084),
      ellipsoid(face, wrist, [0.105, 0.132, 0.105]),
      ellipsoid(face, [side * 0.13, -0.76, 0.17], [0.057, 0.069, 0.059], side * 0.48, 0, 6),
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
  chain(curl, fur, [[0, 0, 0], [0.045, 0.035, -0.31], [0.16, 0.31, -0.67], [0.22, 0.68, -0.71], [0.19, 0.88, -0.53], [0.14, 0.77, -0.33]], [0.084, 0.075, 0.063, 0.055, 0.048, 0.024]);
  attach(tail, curl, material);
  return { head, legs, arms, tail, gait: 'biped' };
}

function rooster(body, material) {
  const plumage = 0x9f593b;
  const chest = 0xe8aa51;
  const tailColor = 0x2c514b;
  const feathersBlue = 0x426e74;
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
      ellipsoid(feathersBlue, [side * 0.44, -0.09, -0.18], [0.24, 0.06, 0.11], side * -0.18),
      ellipsoid(chest, [side * 0.29, 0.063, -0.029], [0.208, 0.041, 0.109], side * -0.16, 0, 7),
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
  for (const dx of [-0.23, 0, 0.23]) {
    const center = dx === 0;
    const rise = center ? 0.72 : 0.51;
    const length = center ? 1.09 : 0.91;
    chain(feathers, center ? tailColor : feathersBlue, [[0, 0, 0], [dx, rise * 0.87, -0.31], [dx * 1.35, rise, -length * 0.67], [dx * 1.5, rise * 0.34, -length]], [0.093, 0.104, 0.077, 0.006]);
  }
  attach(tail, feathers, material);
  return { head, legs, arms, tail, gait: 'bird' };
}

function snake(body, material) {
  const back = 0x497959;
  const belly = 0xf0d5a0;
  const hood = 0x7bad78;
  const marking = 0x335c48;
  const bodyParts = [];
  const neckBase = [-0.32, 0.2, -0.12];
  const tail = pivot(body, neckBase);
  const joint = [0.6, -0.05, -0.78];
  const tip = pivot(tail, joint);
  const curl = [];
  chain(curl, back, [[0, 0, 0], [0.34, -0.005, 0.18], [0.45, -0.015, 0.4]], [0.092, 0.056, 0.015]);
  attach(tip, curl, material);
  chain(bodyParts, back, [joint, [0.15, -0.056, -0.75], [-0.19, -0.058, -0.46], [0, 0, 0]], [0.092, 0.121, 0.145, 0.165]);
  bodyParts.push(
    ellipsoid(back, joint, [0.092, 0.092, 0.092], 0, 0, 6),
    ellipsoid(marking, [0.18, 0.058, -0.735], [0.08, 0.029, 0.06], 0, 0, 6),
    ellipsoid(marking, [-0.173, 0.082, -0.475], [0.067, 0.037, 0.071], 0, 0, 6),
  );
  attach(tail, bodyParts, material);

  const neck = pivot(body, neckBase);
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
      ellipsoid(marking, [side * 0.294, -0.11, 0.12], [0.052, 0.13, 0.016], side * -0.41, 0, 6),
    );
    eye(crown, side * 0.207, 0.165, 0.354, 0.067);
  }
  attach(head, crown, material);
  return { head, neck, tail, tip, legs: [], gait: 'slither' };
}

const BUILDERS = { monkey, rooster, snake };

// Cadence, leg swing, lift and body roll in each species' ground cycle.
const MOTION = {
  rat:    [1.34, 0.51, 0.045, 0.03],
  ox:     [0.83, 0.43, 0.035, 0.07],
  tiger:  [1.0,  0.65, 0.11,  0.035],
  rabbit: [1.13, 0.48, 0.23,  0.02],
  snake:  [1.02, 0,    0,     0.07],
  horse:  [0.94, 0.68, 0.14,  0.03],
  goat:   [1.11, 0.54, 0.11,  0.055],
  monkey: [0.96, 0.63, 0.075, 0.085],
  rooster:[1.36, 0.49, 0.045, 0.04],
  dog:    [1.08, 0.61, 0.095, 0.06],
  pig:    [1.04, 0.46, 0.055, 0.095],
};

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
  const [cadence, maxSwing, bounce, sway] = MOTION[id];
  let phase = 0;
  let idlePhase = 0;
  let effort = 0;
  let power = 0;
  let fallingSpeed = 0;
  let landing = 0;

  function animate(dt, { state = 'idle', speed = 0, verticalSpeed = 0, ability = '' } = {}) {
    const climbing = state === 'climb';
    const moving = state === 'walk' || state === 'run' || climbing;
    const airborne = state === 'air';
    const energetic = state === 'run' || Boolean(ability);
    effort = THREE.MathUtils.damp(effort, moving ? (energetic ? 1 : 0.63) : 0, 14, dt);
    power = THREE.MathUtils.damp(power, ability ? 1 : 0, 17, dt);
    landing = THREE.MathUtils.damp(landing, 0, 14, dt);
    if (airborne) {
      fallingSpeed = Math.max(0, -verticalSpeed);
      landing = 0;
    } else {
      if (!climbing && fallingSpeed > 5) landing = Math.min(fallingSpeed / 36, 1);
      fallingSpeed = 0;
    }
    if (moving || effort > 0.015) phase += dt * cadence * (5 + Math.min(Math.abs(speed), 55) * 0.28);
    idlePhase += dt * 2.8;
    const wave = Math.sin(phase);
    const idleWave = Math.sin(idlePhase);
    const breathing = airborne || climbing ? 0 : (idleWave * 0.5 + 0.5) * (1 - effort);
    const rising = THREE.MathUtils.clamp(verticalSpeed / 18, 0, 1);
    const falling = THREE.MathUtils.clamp(-verticalSpeed / 28, 0, 1);
    const bounding = rig.gait === 'bound' && !climbing && (energetic || id === 'rabbit');
    const galloping = rig.gait === 'gallop' && energetic && !climbing;
    const stride = maxSwing * effort;
    const pulse = bounding || galloping ? (1 - Math.cos(phase)) * 0.5 : Math.abs(wave);
    const compression = landing * (id === 'pig' ? 0.21 : id === 'ox' ? 0.115 : 0.15);
    body.scale.set(1 + compression * 0.28, 1 + breathing * 0.018 - compression, 1 + compression * 0.34);
    body.position.y = floor * body.scale.y + (airborne || climbing ? 0 : pulse * bounce * effort * (1 - landing));
    body.rotation.x = airborne ? -THREE.MathUtils.clamp(verticalSpeed * 0.026, -0.29, 0.29) : wave * effort * (bounding || galloping ? 0.1 : 0.035);
    body.rotation.z = airborne ? 0 : wave * effort * sway;
    if (climbing) body.rotation.x -= 0.15 + (id === 'goat' ? 0.15 * power : 0);
    rig.head.rotation.x = -body.rotation.x * 0.48 + (1 - effort) * idleWave * 0.033;
    rig.head.rotation.y = (1 - effort) * Math.sin(idlePhase * 0.57) * (id === 'rat' || id === 'dog' ? 0.16 : 0.055);

    switch (id) {
      case 'rat':
        body.rotation.x += 0.16 * power;
        rig.head.rotation.x -= 0.08 * power;
        break;
      case 'ox':
        body.rotation.x += 0.08 * power;
        rig.head.rotation.x += 0.31 * power;
        break;
      case 'tiger':
        if (airborne) {
          body.rotation.x -= 0.14 * power;
          body.scale.z = 1 + power * rising * 0.11;
        }
        break;
      case 'rabbit':
        rig.head.rotation.x += airborne ? -0.22 * rising + 0.17 * falling : wave * effort * 0.12;
        break;
      case 'horse':
        rig.head.rotation.x -= wave * effort * 0.12;
        break;
      case 'goat':
        rig.head.rotation.x -= climbing ? 0.14 + 0.2 * power : 0;
        break;
      case 'rooster':
        rig.head.rotation.x += Math.sin(phase * 2) * effort * 0.1;
        break;
      case 'dog':
        rig.head.rotation.x += (0.28 + idleWave * 0.054) * power;
        rig.head.rotation.y += Math.sin(idlePhase * 2) * 0.18 * power;
        break;
      case 'pig':
        if (airborne) body.rotation.x += falling * 0.42 * power;
        break;
    }
    for (const { joint, side, rear } of rig.legs) {
      if (airborne) {
        if (id === 'rabbit') joint.rotation.x = rear ? 0.33 + 0.62 * rising + 0.16 * power : -0.71 + 0.36 * falling;
        else if (id === 'pig') joint.rotation.x = (rear ? 0.31 : -0.31) * (1 - power * 0.65);
        else if (id === 'rooster') joint.rotation.x = 0.64 * (1 - falling * 0.7);
        else joint.rotation.x = rear ? 0.22 + 0.38 * rising : -0.46 + 0.31 * falling - (id === 'tiger' ? 0.33 * power : 0);
        joint.rotation.z = 0;
        continue;
      }
      let offset = (side < 0 ? Math.PI : 0) + (rear ? Math.PI : 0);
      if (bounding) offset = (rear ? Math.PI : 0) + (id === 'rabbit' ? 0 : side * 0.25);
      if (galloping) offset = (rear ? 2.8 : 0) + side * 0.56;
      joint.rotation.x = Math.sin(phase + offset) * stride * (id === 'rabbit' && rear ? 1.32 : 1);
      if (climbing) joint.rotation.x -= rear ? 0.05 : 0.26 + (id === 'goat' ? 0.19 * power : 0);
      joint.rotation.z = id === 'pig' ? side * wave * effort * 0.08 : 0;
    }
    for (const { joint, side } of rig.arms ?? []) {
      if (rig.gait === 'bird') {
        const spread = airborne ? 1 : power;
        joint.rotation.y = side * (1.31 - 1.15 * spread);
        const flap = Math.sin(idlePhase * 3.5) * (0.27 - power * 0.17);
        joint.rotation.z = side * (spread * (0.09 + flap) + wave * stride * 0.25 * (1 - spread));
      } else {
        joint.rotation.x = airborne ? -0.58 - rising * 0.24 - power * (0.63 + side * 0.16) : -wave * stride * side * 1.24;
        if (climbing) joint.rotation.x -= 0.62;
        joint.rotation.z = side * (airborne ? 0.13 : effort * 0.07);
      }
    }
    if (rig.tail) {
      const wag = id === 'dog' ? 0.23 + 0.25 * power : 0.084;
      rig.tail.rotation.y = Math.sin(phase * 0.78) * effort * 0.25 + Math.sin(idlePhase * (id === 'dog' ? 3.3 : 1)) * wag;
      rig.tail.rotation.x = effort * wave * (id === 'horse' ? 0.13 : 0.065);
    }
    if (rig.neck) {
      const slither = effort * (0.44 + 0.16 * power);
      rig.neck.rotation.y = wave * slither + idleWave * 0.075;
      rig.head.rotation.y = -rig.neck.rotation.y * 0.78;
      rig.tail.rotation.y = Math.sin(phase - 1.2) * slither * 0.82 + idleWave * 0.052;
      rig.tail.rotation.x = 0;
      rig.tip.rotation.y = Math.sin(phase - 2.25) * slither + Math.sin(idlePhase - 0.75) * 0.065;
      rig.neck.rotation.x = -rising * 0.14 + falling * 0.16;
      body.position.x = airborne ? 0 : wave * effort * 0.12;
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
