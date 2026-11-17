// Regional centers keep the same architectural language across adjacent blocks.
const DISTRICTS = [
  { x: 0, z: 0, forms: ['tiered', 'shaft', 'offset'], styles: [1, 0, 0] },
  { x: -1530, z: -990, forms: ['beveled', 'shaft', 'beveled'], styles: [0, 0, 1] },
  { x: 1350, z: -1260, forms: ['offset', 'terrace', 'shaft'], styles: [0, 1, 1] },
  { x: -1080, z: 1440, forms: ['courtyard', 'terrace', 'terrace'], styles: [2, 1, 2] },
  { x: 1530, z: 1170, forms: ['courtyard', 'beveled', 'tiered'], styles: [1, 1, 2] },
  { x: -1980, z: 360, forms: ['industrial', 'industrial', 'offset'], styles: [2, 1, 1] },
  { x: 450, z: 1980, forms: ['terrace', 'courtyard', 'terrace'], styles: [2, 2, 1] },
  { x: 810, z: -2070, forms: ['industrial', 'beveled', 'shaft'], styles: [1, 0, 1] },
];

const LANDMARKS = [
  { dx: 0, dz: -1, shape: 'crown', width: 10, depth: 10, height: 52, style: 0 },
  { dx: -17, dz: -11, shape: 'gate', width: 10, depth: 6, height: 40, style: 0 },
  { dx: 15, dz: -14, shape: 'offset', width: 11, depth: 8, height: 45, style: 0 },
  { dx: -12, dz: 16, shape: 'citadel', width: 11, depth: 11, height: 23, style: 2 },
  { dx: 17, dz: 13, shape: 'crown', width: 10, depth: 10, height: 46, style: 1 },
  { dx: -22, dz: 4, shape: 'gate', width: 10, depth: 8, height: 28, style: 1 },
  { dx: 5, dz: 22, shape: 'citadel', width: 11, depth: 11, height: 19, style: 1 },
  { dx: 9, dz: -23, shape: 'beveled', width: 11, depth: 11, height: 46, style: 0 },
];

export function districtArchitecture(x, z) {
  let closest = DISTRICTS[0], best = Infinity;
  for (const district of DISTRICTS) {
    const distance = (x - district.x) ** 2 + (z - district.z) ** 2;
    if (distance >= best) continue;
    closest = district;
    best = distance;
  }
  return closest;
}

export function landmarkAt(i, j, centerBlock) {
  return LANDMARKS.find(({ dx, dz }) => i === centerBlock + dx && j === centerBlock + dz);
}

export function buildingArchitecture(district, lot) {
  const index = Math.min(district.forms.length - 1, Math.floor(lot.seed * district.forms.length));
  const shape = district.forms[index];
  return {
    shape: lot.h < 8 && shape === 'shaft' ? 'terrace' : shape,
    style: district.styles[index],
  };
}

function rectangle(x, z, width, depth) {
  return { x, z, width, depth };
}

// Ranges describe solid cross-sections before the shell is carved out.
// Offsets between sections always keep an overlap for the collapse solver.
function sectionsFor(lot, chunkSize) {
  const w = lot.w / chunkSize, d = lot.d / chunkSize, h = lot.h;
  const full = rectangle(0, 0, w, d);
  const ranges = [];
  let bottom = 0;
  function band(height, rectangles) {
    const top = Math.min(h, Math.round(height));
    if (top <= bottom) return;
    ranges.push({ bottom, top, rectangles });
    bottom = top;
  }
  function inset(x, z) {
    return rectangle(x, z, w - x * 2, d - z * 2);
  }
  function cross(cut) {
    return [
      rectangle(cut, 0, w - cut * 2, d),
      rectangle(0, cut, cut, d - cut * 2),
      rectangle(w - cut, cut, cut, d - cut * 2),
    ];
  }

  switch (lot.shape) {
    case 'gate': {
      const pier = Math.floor(w / 3);
      band(h * 0.74, [rectangle(0, 0, pier, d), rectangle(w - pier, 0, pier, d)]);
      band(h * 0.9, [full]);
      band(h, [inset(1, 1)]);
      break;
    }
    case 'crown':
      band(h * 0.16, [full]);
      band(h * 0.72, [inset(1, 1)]);
      band(h * 0.81, cross(1));
      band(h * 0.9, [inset(2, 2)]);
      band(h * 0.96, [inset(3, 3)]);
      band(h, [inset(4, 4)]);
      break;
    case 'citadel':
      band(h * 0.21, [
        rectangle(1, 0, w - 2, d),
        rectangle(0, 2, 1, d - 4),
        rectangle(w - 1, 2, 1, d - 4),
      ]);
      band(h * 0.47, [inset(1, 1)]);
      band(h * 0.65, [inset(2, 2)]);
      band(h * 0.84, [inset(3, 3)]);
      band(h, [inset(4, 4)]);
      break;
    case 'courtyard':
      if (w >= 6 && d >= 6) {
        const ring = [
          rectangle(0, 0, 2, d), rectangle(w - 2, 0, 2, d),
          rectangle(2, 0, w - 4, 2), rectangle(2, d - 2, w - 4, 2),
        ];
        // A street-level passage gives access to the open courtyard.
        band(1, [ring[0], ring[1], ring[3], rectangle(2, 0, Math.max(0, w - 5), 2)]);
        band(h, ring);
        break;
      }
      band(h, [full]);
      break;
    case 'industrial': {
      const split = Math.ceil(w / 2);
      band(h * 0.7, [full]);
      band(h, [rectangle(lot.seed < 0.5 ? 0 : w - split, 0, split, d)]);
      break;
    }
    case 'terrace':
      band(h * 0.5, [full]);
      band(h * 0.78, [rectangle(0, 0, w - 1, d)]);
      band(h, [rectangle(0, 0, w - 1, d - 1)]);
      break;
    case 'offset': {
      const flip = lot.seed >= 0.5;
      const thick = Math.max(3, w - 2);
      band(h * 0.33, [rectangle(flip ? w - thick : 0, 0, thick, d)]);
      band(h * 0.66, [rectangle(Math.floor((w - thick) / 2), 0, thick, d)]);
      band(h, [rectangle(flip ? 0 : w - thick, 1, thick, d - 1)]);
      break;
    }
    case 'beveled':
      band(h * 0.83, cross(1));
      band(h, [inset(1, 1)]);
      break;
    case 'shaft':
      band(h * 0.18, [full]);
      band(h, [inset(w >= 6 ? 1 : 0, d >= 6 ? 1 : 0)]);
      break;
    default:
      if (h > 18 && w >= 6 && d >= 6) {
        band(Math.floor(h * 0.62), [full]);
        band(Math.floor(h * 0.84), [inset(1, 1)]);
        band(h, [inset(2, 2)]);
      } else {
        if (h > 10 && w >= 5 && d >= 5) band(Math.floor(h * 0.75), [full]);
        band(h, [h > 10 && w >= 5 && d >= 5 ? inset(1, 1) : full]);
      }
  }
  return ranges;
}

function footprint(rectangles, width, depth) {
  const stride = width + 2;
  const mask = new Uint8Array(stride * (depth + 2));
  for (const rect of rectangles) {
    for (let z = rect.z; z < rect.z + rect.depth; z++) {
      const row = (z + 1) * stride + rect.x + 1;
      mask.fill(1, row, row + rect.width);
    }
  }
  return mask;
}

export function groundEntrance(lot, chunkSize) {
  const designated = lot.shape === 'crown' || (lot.seed < 0.08 && lot.h >= 4
    && (lot.shape === 'tiered' || lot.shape === 'terrace' || lot.shape === 'industrial'));
  if (!designated || lot.w < chunkSize * 5 || lot.d < chunkSize * 5) return;
  return { x: Math.floor((lot.w / chunkSize - 1) / 2), z: lot.d / chunkSize - 1 };
}

export function forEachBuildingCell(lot, chunkSize, emit) {
  const w = lot.w / chunkSize, d = lot.d / chunkSize;
  const stride = w + 2;
  const entrance = groundEntrance(lot, chunkSize);
  const masks = sectionsFor(lot, chunkSize).map(({ bottom, top, rectangles }) => ({
    bottom, top, mask: footprint(rectangles, w, d),
  }));
  for (let section = 0; section < masks.length; section++) {
    const { bottom, top, mask } = masks[section];
    const below = masks[section - 1]?.mask;
    const overhang = below && mask.some((value, i) => value > below[i]);
    for (let y = bottom; y < top; y++) {
      // Seal each setback and join any projections to the roof below.
      const slab = y % 6 === 5 || y === top - 1 || (overhang && y === bottom);
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
        const i = (z + 1) * stride + x + 1;
        if (!mask[i]) continue;
        if (y === 0 && entrance && x === entrance.x && z === entrance.z) continue;
        if (slab || !mask[i - 1] || !mask[i + 1]
          || !mask[i - stride] || !mask[i + stride]) emit(x, y, z);
      }
    }
  }
}

export function roofBounds(lot, chunkSize) {
  const { rectangles } = sectionsFor(lot, chunkSize).at(-1);
  const x0 = Math.min(...rectangles.map(({ x }) => x));
  const z0 = Math.min(...rectangles.map(({ z }) => z));
  const x1 = Math.max(...rectangles.map(({ x, width }) => x + width));
  const z1 = Math.max(...rectangles.map(({ z, depth }) => z + depth));
  return { x0, z0, x1, z1 };
}

// Distant landmarks retain their main silhouette using their cross-section
// boxes. The normal lots still use a single coarse proxy.
export function landmarkProxyBoxes(lot, chunkSize) {
  return sectionsFor(lot, chunkSize).flatMap(({ bottom, top, rectangles }) => rectangles.map((rect) => ({
    x: lot.x + (rect.x + rect.width / 2) * chunkSize,
    z: lot.z + (rect.z + rect.depth / 2) * chunkSize,
    y: (bottom + top) * chunkSize / 2,
    w: rect.width * chunkSize, d: rect.depth * chunkSize, h: (top - bottom) * chunkSize,
  })));
}
