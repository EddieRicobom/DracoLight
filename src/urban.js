import * as THREE from 'three';
import { rng } from './util.js';
import { roofBounds } from './city-architecture.js';

// Bake a neutral overhead fill into the equipment itself. The roof details
// keep their volume when the character lights move across the city.
function addFixedShading(geometry) {
  const normals = geometry.getAttribute('normal');
  const shades = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const shade = THREE.MathUtils.clamp(0.72 + normals.getY(i) * 0.22 + normals.getX(i) * 0.06 + normals.getZ(i) * 0.04, 0.5, 1);
    shades.fill(shade, i * 3, i * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3));
  return geometry;
}

// Decorative roof equipment. Each part is attached to one existing roof chunk;
// it never enters the city's collision, damage, or collapse grid.
export function createUrbanDetails(scene, city) {
  const random = rng(26791);
  const groups = [
    { geometry: addFixedShading(new THREE.BoxGeometry(1, 1, 1)), color: 0xa9a9a2, parts: [] }, // HVAC cabinets
    { geometry: addFixedShading(new THREE.CylinderGeometry(1, 1, 1, 8)), color: 0x676e70, parts: [] }, // vents and fans
    { geometry: addFixedShading(new THREE.CylinderGeometry(1, 1, 1, 6)), color: 0xb3a99c, parts: [] }, // aerials
  ];
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const supports = [];

  function add(group, support, x, y, z, sx, sy, sz, tint) {
    if (support < 0) return;
    group.parts.push({ support, x, y, z, sx, sy, sz, tint });
  }

  for (const lot of city.lots) {
    const { x0, z0, x1, z1 } = roofBounds(lot, 5);
    const tall = lot.h > 18;
    const cols = x1 - x0, rows = z1 - z0;
    if (cols < 2 || rows < 2) continue;
    const roofY = lot.h * 5;
    const used = new Set();
    const unitCount = Math.min(3, Math.max(1, Math.floor(cols * rows / 14)));
    for (let k = 0; k < unitCount + 1; k++) {
      // Prefer the interior, but give narrow roofs and courtyards an edge fallback.
      let x, z, support = -1;
      for (let tries = 0; tries < 12; tries++) {
        const insetX = tries < 6 && cols > 2 ? 1 : 0;
        const insetZ = tries < 6 && rows > 2 ? 1 : 0;
        const col = insetX + Math.floor(random() * (cols - 2 * insetX));
        const row = insetZ + Math.floor(random() * (rows - 2 * insetZ));
        const key = col + row * cols;
        if (used.has(key)) continue;
        x = lot.x + (x0 + col + 0.5) * 5;
        z = lot.z + (z0 + row + 0.5) * 5;
        support = city.chunkAt(x, roofY - 2.5, z);
        if (support < 0) continue;
        used.add(key);
        break;
      }
      if (support < 0) continue;
      const shade = 0.75 + random() * 0.35;
      if (k < unitCount) {
        const width = 2.1 + random() * 1.2;
        const depth = 2.0 + random() * 1.3;
        const height = 1.25 + random() * 0.65;
        add(groups[0], support, x, roofY + height / 2 + 0.08, z, width, height, depth, shade);
        add(groups[1], support, x, roofY + height + 0.16, z, 0.56, 0.2, 0.56, shade * 0.8);
      } else if (random() < (tall ? 0.65 : 0.24)) {
        const height = tall ? 4 + random() * 5 : 2.3 + random() * 2;
        add(groups[2], support, x, roofY + height / 2, z, 0.11, height, 0.11, shade);
        add(groups[2], support, x, roofY + height * 0.78, z, 1.4, 0.08, 0.08, shade);
      } else {
        const height = 0.7 + random() * 0.7;
        add(groups[1], support, x, roofY + height / 2, z, 0.55, height, 0.55, shade);
      }
    }
  }

  const meshes = groups.map((group) => {
    const mesh = new THREE.InstancedMesh(
      group.geometry,
      new THREE.MeshBasicMaterial({ color: group.color, vertexColors: true, fog: true }),
      group.parts.length,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    group.parts.forEach((part, i) => {
      matrix.makeScale(part.sx, part.sy, part.sz).setPosition(part.x, part.y, part.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setScalar(part.tint));
      supports.push({ mesh, index: i, chunk: part.support, visible: true, matrix: matrix.clone() });
    });
    scene.add(mesh);
    return mesh;
  });

  let elapsed = 0;
  function sync() {
    for (const item of supports) {
      const visible = !!city.alive[item.chunk];
      if (item.visible === visible) continue;
      item.visible = visible;
      item.mesh.setMatrixAt(item.index, visible ? item.matrix : matrix.makeScale(0, 0, 0));
      item.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    update(dt) {
      elapsed += dt;
      if (elapsed < 0.2) return;
      elapsed = 0;
      sync();
    },
    reset() { elapsed = 0; sync(); },
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
