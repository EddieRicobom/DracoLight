import * as THREE from 'three';
import { groundEntrance } from './city-architecture.js';

const REGION_SIZE = 450;
const GUIDE_RANGE = 260;
const DRAW_RANGE = 110;
const SAVE_PREFIX = 'draco-light-relic-v1:';
const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function findPosition(lot, chunkSize, chunkAt) {
  const width = lot.w / chunkSize, depth = lot.d / chunkSize;
  const centerX = (width - 1) / 2, centerZ = (depth - 1) / 2;
  const y = chunkSize / 2;
  const worldX = (x) => lot.x + (x + 0.5) * chunkSize;
  const worldZ = (z) => lot.z + (z + 0.5) * chunkSize;
  const solid = (x, z, height = y) => chunkAt(worldX(x), height, worldZ(z)) >= 0;

  if (lot.shape === 'courtyard' && width >= 6 && depth >= 6) {
    const passageX = width - 3;
    const x = Math.floor(centerX), z = Math.floor(centerZ);
    // The courtyard is reached from the street by its ground-level passage.
    if (!solid(passageX, 0) && !solid(passageX, 1) && !solid(passageX, z) && !solid(x, z)) {
      return { x: worldX(x), y, z: worldZ(z), access: 'Pátio', entryX: worldX(passageX), entryZ: lot.z };
    }
  }
  if (lot.shape === 'gate') {
    const x = Math.floor(centerX), z = Math.floor(centerZ);
    if (!solid(x, 0) && !solid(x, z) && !solid(x, depth - 1)) {
      return { x: worldX(x), y, z: worldZ(z), access: 'Passagem', entryX: worldX(x), entryZ: lot.z };
    }
  }
  const entrance = groundEntrance(lot, chunkSize);
  if (entrance) {
    const x = entrance.x, z = Math.floor(centerZ);
    let clear = true;
    for (let step = z; step <= entrance.z; step++) {
      if (solid(x, step)) { clear = false; break; }
    }
    if (clear) return { x: worldX(x), y, z: worldZ(z), access: 'Entrada', entryX: worldX(x), entryZ: lot.z + lot.d };
  }

  let best = Infinity, position;
  for (let x = 1; x < width - 1; x++) {
    for (let z = 1; z < depth - 1; z++) {
      const distance = (x - centerX) ** 2 + (z - centerZ) ** 2;
      if (distance >= best || solid(x, z) || solid(x, z, y + chunkSize)) continue;
      const enclosed = SIDES.every(([dx, dz]) => {
        for (let i = x + dx, j = z + dz; i >= 0 && i < width && j >= 0 && j < depth; i += dx, j += dz) {
          if (solid(i, j)) return true;
        }
        return false;
      });
      if (!enclosed) continue;
      best = distance;
      position = { x: worldX(x), y, z: worldZ(z), access: 'Interior' };
    }
  }
  return position;
}

export function placeRelics(lots, chunkSize, chunkAt) {
  const regions = new Map();
  for (const lot of lots) {
    const cx = lot.x + lot.w / 2, cz = lot.z + lot.d / 2;
    const rx = Math.floor(cx / REGION_SIZE + 0.5), rz = Math.floor(cz / REGION_SIZE + 0.5);
    const key = `${rx},${rz}`;
    const rank = Math.hypot(cx - rx * REGION_SIZE, cz - rz * REGION_SIZE) + lot.seed * 45;
    const publicSpace = lot.shape === 'gate'
      || (lot.shape === 'courtyard' && lot.w >= chunkSize * 6 && lot.d >= chunkSize * 6);
    const accessBonus = publicSpace ? 1400 : groundEntrance(lot, chunkSize) ? 1000 : 0;
    if (!regions.has(key)) regions.set(key, []);
    regions.get(key).push({ lot, rank: rank - accessBonus - (lot.landmark ? 600 : 0) });
  }

  const relics = [];
  for (const region of regions.values()) {
    region.sort((a, b) => a.rank - b.rank || a.lot.x - b.lot.x || a.lot.z - b.lot.z);
    for (const { lot } of region) {
      const position = findPosition(lot, chunkSize, chunkAt);
      if (!position) continue;
      relics.push({ ...position, lot, id: `${lot.x},${lot.z}` });
      break;
    }
  }
  return relics;
}

function loadRelics(relics, storage) {
  try {
    if (storage) {
      return new Set(relics.map(({ id }) => id).filter((id) => storage.getItem(SAVE_PREFIX + id) === '1'));
    }
  } catch { /* Storage can be unavailable. */ }
  return new Set();
}

export class RelicCollection {
  constructor(relics, storage, raycast) {
    this.remaining = new Map(relics.map((relic) => [relic.id, relic]));
    this.collected = loadRelics(relics, storage);
    for (const id of this.collected) this.remaining.delete(id);
    this.total = relics.length;
    this.storage = storage;
    this.raycast = raycast;
    this.motion = new THREE.Vector3();
    this.closest = new THREE.Vector3();
    this.direction = new THREE.Vector3();
  }

  sweep(start, end, height, radius) {
    const motion = this.motion.subVectors(end, start);
    const lengthSq = motion.lengthSq();
    const startY = start.y + height;
    let count = 0;
    for (const relic of this.remaining.values()) {
      const dx = relic.x - start.x, dy = relic.y - startY, dz = relic.z - start.z;
      const t = lengthSq === 0 ? 0 : THREE.MathUtils.clamp((dx * motion.x + dy * motion.y + dz * motion.z) / lengthSq, 0, 1);
      const direction = this.direction.set(dx - t * motion.x, dy - t * motion.y, dz - t * motion.z);
      const distanceSq = direction.lengthSq();
      if (distanceSq > radius ** 2) continue;
      if (distanceSq > 0) {
        const distance = Math.sqrt(distanceSq);
        this.closest.copy(start).addScaledVector(motion, t).y += height;
        if (this.raycast(this.closest, direction.multiplyScalar(1 / distance), distance) < distance) continue;
      }
      this.remaining.delete(relic.id);
      this.collected.add(relic.id);
      count++;
      // Independent keys preserve discoveries when the game runs in multiple tabs.
      try { this.storage?.setItem(SAVE_PREFIX + relic.id, '1'); }
      catch { /* Keep the collection in memory when saving is unavailable. */ }
    }
    return count;
  }
}

export function createCityRelics(scene, city, chunkSize, { count, hint, bearing, notice }) {
  let storage;
  try { storage = globalThis.localStorage; }
  catch { /* The browser may block access to storage. */ }
  const relics = placeRelics(city.lots, chunkSize, city.chunkAt.bind(city));
  const collection = new RelicCollection(relics, storage, city.raycast.bind(city));
  const geometry = new THREE.OctahedronGeometry(1.35);
  geometry.scale(0.78, 1, 0.78);
  const material = new THREE.MeshBasicMaterial({ color: 0xf5f5f5, toneMapped: false });
  const edges = new THREE.EdgesGeometry(geometry);
  const ink = new THREE.LineBasicMaterial({ color: 0x252525, toneMapped: false });
  const markers = Array.from({ length: 8 }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Relíquia';
    mesh.add(new THREE.LineSegments(edges, ink));
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
  let noticeUntil = 0;
  let shownHint = '';
  const updateCount = () => { count.textContent = `Relíquias ${collection.collected.size}/${collection.total}`; };
  updateCount();

  return {
    update(start, end, yaw, time, actorHeight) {
      const found = collection.sweep(start, end, actorHeight, actorHeight ? 2.7 : 5.5);
      if (found) {
        updateCount();
        notice.textContent = collection.remaining.size ? 'Relíquia encontrada!' : 'Todas as relíquias encontradas!';
        noticeUntil = time + 3;
      } else if (noticeUntil > 0 && time >= noticeUntil) {
        notice.textContent = '';
        noticeUntil = 0;
      }
      let nearest = null, nearestSq = GUIDE_RANGE ** 2, visible = 0;
      for (const relic of collection.remaining.values()) {
        const distanceSq = (relic.x - end.x) ** 2 + (relic.y - end.y) ** 2 + (relic.z - end.z) ** 2;
        if (distanceSq < nearestSq) { nearest = relic; nearestSq = distanceSq; }
        if (distanceSq >= DRAW_RANGE ** 2 || visible >= markers.length) continue;
        const mesh = markers[visible++];
        mesh.visible = true;
        mesh.position.set(relic.x, relic.y + Math.sin(time * 2.5) * 0.3, relic.z);
        mesh.rotation.y = time * 1.8;
      }
      for (let i = visible; i < markers.length; i++) markers[i].visible = false;
      const label = nearest ? `${nearest.access} · ${Math.ceil(Math.sqrt(nearestSq) / 5) * 5} m` : '';
      if (label !== shownHint) {
        hint.textContent = label;
        bearing.hidden = !nearest;
        shownHint = label;
      }
      if (nearest) {
        const { lot, entryX, entryZ } = nearest;
        const outside = end.x < lot.x || end.x > lot.x + lot.w || end.z < lot.z || end.z > lot.z + lot.d;
        const guideEntry = actorHeight > 0 && outside && entryX !== undefined;
        const guideX = guideEntry ? entryX : nearest.x;
        const guideZ = guideEntry
          ? entryZ + (nearest.access === 'Passagem' && end.z > nearest.z ? lot.d : 0)
          : nearest.z;
        const angle = yaw - Math.atan2(guideX - end.x, guideZ - end.z);
        bearing.style.transform = `rotate(${angle}rad)`;
      }
    },
  };
}
