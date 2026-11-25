// Ink personalities for the ground characters. The dragon paints with ribbons and
// tornadoes; every zodiac animal instead leaves its own recognisable brushwork.
export const ZODIAC_INK = Object.freeze({
  rat: Object.freeze({ style: 'dash', label: 'Rastro Fugaz' }),
  ox: Object.freeze({ style: 'stroke', label: 'Arado de Tinta' }),
  tiger: Object.freeze({ style: 'claw', label: 'Garras Pintadas' }),
  rabbit: Object.freeze({ style: 'stamp', label: 'Carimbos' }),
  snake: Object.freeze({ style: 'ribbon', label: 'Rio de Tinta' }),
  horse: Object.freeze({ style: 'streak', label: 'Crina de Pincel' }),
  goat: Object.freeze({ style: 'spray', label: 'Chuva Alpina' }),
  monkey: Object.freeze({ style: 'handprint', label: 'Mãos de Pincel' }),
  rooster: Object.freeze({ style: 'fan', label: 'Leque de Penas' }),
  dog: Object.freeze({ style: 'dots', label: 'Faro de Tinta' }),
  pig: Object.freeze({ style: 'pool', label: 'Poça Compacta' }),
});

export const INK_STYLES = new Set(Object.values(ZODIAC_INK).map(({ style }) => style));

const TAU = Math.PI * 2;

/**
 * Returns paint samples for a species' ink pattern. Each sample is a plain
 * { x, y, z, r } circle, so the same data can paint the local city or be sent
 * across the co-op connection.
 */
export function inkPatternPoints(style, position, direction = { x: 0, z: 1 }, scale = 1) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return [];
  let dx = Number.isFinite(direction?.x) ? direction.x : 0;
  let dz = Number.isFinite(direction?.z) ? direction.z : 1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) { dx = 0; dz = 1; } else { dx /= length; dz /= length; }
  // Left-hand normal, so positive "across" values read naturally from above.
  const sx = -dz, sz = dx;
  const amount = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 4) : 1;
  const y = Number.isFinite(position.y) ? position.y : 0;
  const points = [];
  const add = (along, across, radius) => {
    const x = position.x + (dx * along + sx * across) * amount;
    const z = position.z + (dz * along + sz * across) * amount;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    points.push({ x, y, z, r: Math.max(0.35, radius * amount) });
  };

  switch (style) {
    case 'dash':
      for (let i = 0; i < 8; i++) add(-2 + i * 1.35, 0, 1.15 - Math.abs(i - 4) * 0.07);
      break;
    case 'stroke':
      for (let i = 0; i < 9; i++) {
        const along = -3 + i * 1.5;
        add(along, -2.3, 1.35);
        add(along, 2.3, 1.35);
      }
      break;
    case 'claw':
      for (const lane of [-1, 0, 1]) {
        for (let i = 0; i < 6; i++) {
          const along = 1 + i * 1.55;
          add(along, lane * (1.1 + along * 0.42), 1.05 - i * 0.06);
        }
      }
      break;
    case 'stamp':
      add(0, 0, 2.2);
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * TAU;
        add(Math.cos(angle) * 2.6, Math.sin(angle) * 2.6, 1.45);
      }
      break;
    case 'ribbon':
      for (let i = 0; i < 15; i++) {
        const t = i / 14;
        add(t * 10, Math.sin(t * TAU) * 2.5, 1.8 - t * 0.45);
      }
      break;
    case 'streak':
      for (const lane of [-1.7, 0, 1.7]) {
        for (let i = 0; i < 10; i++) add(-2 + i * 1.55, lane * (0.6 + i * 0.06), 1.3);
      }
      break;
    case 'spray':
      for (let i = 0; i < 18; i++) {
        const along = 2 + (i % 6) * 1.35;
        const across = Math.sin(i * 2.3999632297) * Math.min(6.5, along * 0.62);
        add(along, across, 0.65 + (i % 4) * 0.17);
      }
      break;
    case 'handprint':
      add(4, 0, 2.1);
      for (let i = 0; i < 5; i++) {
        const angle = -0.72 + i / 4 * 1.44;
        add(5.5 + Math.cos(angle) * 2.4, Math.sin(angle) * 2.7, 0.85);
      }
      break;
    case 'fan':
      for (let i = 0; i < 15; i++) {
        const angle = -0.76 + i / 14 * 1.52;
        const distance = 3 + (i % 3) * 2.1;
        add(Math.cos(angle) * distance, Math.sin(angle) * distance, 0.95 - (i % 3) * 0.1);
      }
      break;
    case 'dots':
      for (let i = 0; i < 7; i++) add(2 + i * 2, i % 2 ? 0.9 : -0.9, 1.25);
      break;
    case 'pool':
      add(0, 0, 6);
      for (let i = 0; i < 10; i++) {
        const angle = i / 10 * TAU;
        add(Math.cos(angle) * 5.2, Math.sin(angle) * 5.2, 2.1);
      }
      break;
    default:
      add(0, 0, 1.6);
      break;
  }
  return points;
}

/**
 * Remembers a short strip of ink behind a running animal. Crossing an older
 * part of your own trail (a loop, a hook, a tight turn) produces a surge,
 * mirroring the dragon's ink tornado without requiring flight.
 */
export class InkFlow {
  constructor({
    spacing = 2.4, lifetime = 5, minAge = 0.7, radius = 2.6,
    cooldown = 1.4, maxPoints = 160,
  } = {}) {
    this.spacing = spacing;
    this.lifetime = lifetime;
    this.minAge = minAge;
    this.radius = radius;
    this.cooldown = cooldown;
    this.maxPoints = maxPoints;
    this.reset();
  }

  reset() {
    this.points = [];
    this.lastPoint = null;
    this.lastSurfAt = -Infinity;
  }

  record(position, time, active = true) {
    if (!active || !position || !Number.isFinite(position.x) || !Number.isFinite(position.z)
        || !Number.isFinite(time)) {
      this.lastPoint = null;
      return;
    }
    if (this.lastPoint) {
      const dx = position.x - this.lastPoint.x, dz = position.z - this.lastPoint.z;
      if (dx * dx + dz * dz < this.spacing * this.spacing) return;
    }
    this.lastPoint = { x: position.x, y: position.y, z: position.z };
    this.points.push({ x: position.x, y: position.y, z: position.z, t: time });
    if (this.points.length > this.maxPoints) this.points.shift();
  }

  /** True when the animal has just closed a loop over its own still-wet ink. */
  surf(position, time) {
    if (!position || !Number.isFinite(time) || time - this.lastSurfAt < this.cooldown) return false;
    const r2 = this.radius * this.radius;
    for (const point of this.points) {
      const age = time - point.t;
      if (age < this.minAge) break;
      if (age > this.lifetime) continue;
      const dx = point.x - position.x, dz = point.z - position.z;
      if (dx * dx + dz * dz > r2) continue;
      if (Math.abs(point.y - position.y) > 4) continue;
      this.lastSurfAt = time;
      // Consume the loop so the same stretch cannot fire twice.
      this.points = [];
      this.lastPoint = null;
      return true;
    }
    return false;
  }
}
