import * as THREE from 'three';
import { rng } from './util.js';

// Decorative roof equipment. Each part is attached to one existing roof chunk;
// it never enters the city's collision, damage, or collapse grid.
export function createUrbanDetails(scene, city) {
  const random = rng(26791);
  const groups = [
    { geometry: new THREE.BoxGeometry(1, 1, 1), color: 0xa9a9a2, parts: [] }, // HVAC cabinets
    { geometry: new THREE.CylinderGeometry(1, 1, 1, 8), color: 0x676e70, parts: [] }, // vents and fans
    { geometry: new THREE.CylinderGeometry(1, 1, 1, 6), color: 0xb3a99c, parts: [] }, // aerials
  ];
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const supports = [];

  function add(group, support, x, y, z, sx, sy, sz, tint) {
    if (support < 0) return;
    group.parts.push({ support, x, y, z, sx, sy, sz, tint });
  }

  for (const lot of city.lots) {
    const w = lot.w / 5, d = lot.d / 5;
    const tall = lot.h > 18 && w >= 6 && d >= 6;
    const inset = tall ? 2 : lot.h > 10 && w >= 5 && d >= 5 ? 1 : 0;
    const cols = w - inset * 2, rows = d - inset * 2;
    if (cols < 2 || rows < 2) continue;
    const roofY = lot.h * 5;
    const used = new Set();
    const unitCount = Math.min(3, Math.max(1, Math.floor(cols * rows / 14)));
    for (let k = 0; k < unitCount + 1; k++) {
      // Keep equipment in the interior, away from the roof edge and setbacks.
      let col, row, key;
      for (let tries = 0; tries < 12; tries++) {
        col = inset + 1 + Math.floor(random() * Math.max(1, cols - 2));
        row = inset + 1 + Math.floor(random() * Math.max(1, rows - 2));
        key = col + row * w;
        if (!used.has(key)) break;
      }
      if (used.has(key)) continue;
      used.add(key);
      const x = lot.x + (col + 0.5) * 5;
      const z = lot.z + (row + 0.5) * 5;
      const support = city.chunkAt(x, roofY - 2.5, z);
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
      new THREE.MeshStandardMaterial({ color: group.color, roughness: 0.83, metalness: 0.32 }),
      group.parts.length,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.parts.forEach((part, i) => {
      matrix.makeScale(part.sx, part.sy, part.sz).setPosition(part.x, part.y, part.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setScalar(part.tint));
      supports.push({ mesh, index: i, chunk: part.support, visible: true });
    });
    scene.add(mesh);
    return mesh;
  });

  let elapsed = 0;
  return {
    update(dt) {
      elapsed += dt;
      if (elapsed < 0.2) return;
      elapsed = 0;
      for (const item of supports) {
        if (!item.visible || city.alive[item.chunk]) continue;
        item.visible = false;
        item.mesh.setMatrixAt(item.index, matrix.makeScale(0, 0, 0));
        item.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
