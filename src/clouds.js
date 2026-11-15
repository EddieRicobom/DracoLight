import * as THREE from 'three';

const DEFAULT_SEED = 0x51c10d;
const UNIT = new THREE.Vector3();
const FROM = new THREE.Vector3();
const TO = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();
const SCALE = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/**
 * Create a deterministic, neutral cloud field. Call update(dt, position, active)
 * every frame; active=false lets clouds recover without reacting to the biped.
 * During flight the previous position is remembered so fast passages register.
 */
export function createClouds(scene, { count = 72, seed = DEFAULT_SEED, extent = 3100 } = {}) {
  const random = randomGenerator(seed);
  const cloudCount = Math.max(0, Math.floor(count));
  const puffsPerCloud = 5;
  const puffs = [];
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const material = new THREE.MeshLambertMaterial({
    color: 0xd9dde0,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    flatShading: true,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cloudCount * puffsPerCloud);
  mesh.name = 'Procedural clouds';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  for (let i = 0; i < cloudCount; i++) {
    const x = (random() * 2 - 1) * extent;
    const z = (random() * 2 - 1) * extent;
    const layer = i % 3;
    const y = [460, 1050, 1950][layer] + (random() - 0.5) * [150, 300, 500][layer];
    const width = 48 + random() * 58;
    for (let j = 0; j < puffsPerCloud; j++) {
      const angle = j * Math.PI * 2 / puffsPerCloud + random() * 0.45;
      const spread = j === 0 ? 0 : 0.38 + random() * 0.48;
      const size = width * (j === 0 ? 0.86 : 0.55 + random() * 0.27);
      const puff = {
        anchor: new THREE.Vector3(
          x + Math.cos(angle) * width * spread,
          y + (random() - 0.5) * 30,
          z + Math.sin(angle) * width * spread,
        ),
        size,
        offset: new THREE.Vector3(),
        distortion: 0,
      };
      puffs.push(puff);
      SCALE.set(size, size * 0.60, size * 0.82);
      MATRIX.compose(puff.anchor, QUATERNION, SCALE);
      mesh.setMatrixAt(puffs.length - 1, MATRIX);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  let previousPosition = null;
  let disposed = false;
  function update(dt, dragonPosition, active = true) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const interacting = active && dragonPosition != null;
    if (!interacting) previousPosition = null;
    const step = Math.min(dt, 0.1);
    if (interacting) {
      FROM.copy(previousPosition ?? dragonPosition);
      TO.copy(dragonPosition).sub(FROM);
    } else {
      FROM.set(0, 0, 0);
      TO.set(0, 0, 0);
    }
    // A teleport must not tear a line through the whole cloud field.
    const traversed = interacting && TO.lengthSq() <= 500 * 500;
    const segmentLengthSq = traversed ? TO.lengthSq() : 0;
    const approach = 1 - Math.exp(-9 * step);
    const recovery = 1 - Math.exp(-2.2 * step);
    let changed = false;

    for (let i = 0; i < puffs.length; i++) {
      const puff = puffs[i];
      const anchor = puff.anchor;
      const t = segmentLengthSq > 0
        ? THREE.MathUtils.clamp(UNIT.copy(anchor).sub(FROM).dot(TO) / segmentLengthSq, 0, 1)
        : 1;
      UNIT.copy(anchor).sub(FROM).addScaledVector(TO, -t);
      const radius = puff.size + 48;
      const distanceSq = UNIT.lengthSq();
      const influence = interacting && distanceSq < radius * radius
        ? Math.pow(1 - Math.sqrt(distanceSq) / radius, 2)
        : 0;
      if (influence === 0 && puff.offset.lengthSq() < 0.0025 && puff.distortion < 0.002) continue;

      // Push away from the flight path. When directly centered, use a stable
      // sideways direction rather than normalizing a zero vector.
      if (distanceSq > 0.0001) UNIT.multiplyScalar(1 / Math.sqrt(distanceSq));
      else if (segmentLengthSq > 0.0001) UNIT.set(-TO.z, 0, TO.x).normalize();
      else UNIT.set(1, 0, 0);
      const target = influence * 38;
      const rate = influence > 0 ? approach : recovery;
      puff.offset.x += (UNIT.x * target - puff.offset.x) * rate;
      puff.offset.y += (UNIT.y * target * 0.45 - puff.offset.y) * rate;
      puff.offset.z += (UNIT.z * target - puff.offset.z) * rate;
      puff.distortion += (influence - puff.distortion) * rate;
      if (influence === 0 && puff.offset.lengthSq() < 0.0025 && puff.distortion < 0.002) {
        puff.offset.set(0, 0, 0);
        puff.distortion = 0;
      }
      const deformation = puff.distortion;
      SCALE.set(
        puff.size * (1 + 0.14 * deformation),
        puff.size * 0.60 * (1 - 0.18 * deformation),
        puff.size * 0.82 * (1 + 0.14 * deformation),
      );
      UNIT.copy(anchor).add(puff.offset);
      MATRIX.compose(UNIT, QUATERNION, SCALE);
      mesh.setMatrixAt(i, MATRIX);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
    if (interacting) {
      if (!previousPosition) previousPosition = new THREE.Vector3();
      previousPosition.copy(dragonPosition);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
