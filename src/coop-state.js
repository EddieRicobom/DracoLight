import { ZODIAC_IMPACTS } from './zodiac-abilities.js';
import { ZODIAC_INK } from './zodiac-ink.js';
import { isZodiacSpecies } from './zodiac-species.js';

const DEFAULT_SPECIES = 'boykisser';
const MOTIONS = new Set(['idle', 'walk', 'run', 'climb', 'air']);
const IMPACT_DISTANCE = 45;
// A charging animal can hit neighbouring walls within a fraction of a second.
const IMPACT_INTERVAL = 0.05;
const PAINT_DISTANCE = 80;
const PAINT_INTERVAL = 0.1;
const BURST_DISTANCE = 100;
const BURST_INTERVAL = 0.2;
const BURST_KINDS = new Set(['breach', 'comet']);

const withinWorld = (value) => Number.isFinite(value) && Math.abs(value) < 30000;
const isWorldPosition = (p) => Array.isArray(p) && p.length === 3 && withinWorld(p[0]) && withinWorld(p[1]) && withinWorld(p[2]);
const bounded = (value, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;

export function readCoopState(message, { role, peerId, selfId }) {
  if (message?.type !== 'state' || (role !== 'host' && role !== 'guest')) return null;
  if (!isWorldPosition(message.p)
      || !Number.isFinite(message.yaw) || (message.mode !== 'dragon' && message.mode !== 'human')) return null;

  // For guests, peerId belongs to the host and other IDs describe relayed guests.
  const id = role === 'host' ? peerId : message.id;
  if (typeof id !== 'string' || id === selfId) return null;
  const mode = role === 'guest' && id === peerId ? 'dragon' : 'human';
  const state = {
    type: 'state',
    id,
    mode,
    p: message.p,
    yaw: message.yaw,
    pitch: bounded(message.pitch, -1.35, 1.35),
    speed: bounded(message.speed, 0, 5000),
    color: typeof message.color === 'string' && /^#[0-9a-f]{6}$/i.test(message.color) ? message.color : '#ef4444',
    motion: MOTIONS.has(message.motion) ? message.motion : 'idle',
  };

  if (mode === 'human') {
    const { species } = message;
    // Earlier clients sent only mode and rendered Boykisser for every human.
    state.species = isZodiacSpecies(species) ? species : DEFAULT_SPECIES;
    state.facingYaw = Number.isFinite(message.facingYaw) ? message.facingYaw : message.yaw;
    state.verticalSpeed = bounded(message.verticalSpeed, -300, 300);
    state.ability = message.ability === true && state.species !== DEFAULT_SPECIES;
  }
  return state;
}

export function readCoopZodiacImpact(message, { remote, elapsed, lastImpactAt = -Infinity }) {
  if (message?.type !== 'zodiac-impact' || remote?.mode !== 'human') return null;
  const { species, p } = message;
  if (typeof species !== 'string' || species !== remote.species || !Object.hasOwn(ZODIAC_IMPACTS, species)) return null;
  if (!isWorldPosition(p) || !Number.isFinite(elapsed) || !(elapsed >= lastImpactAt + IMPACT_INTERVAL)) return null;

  const dx = p[0] - remote.target?.x;
  const dy = p[1] - remote.target?.y;
  const dz = p[2] - remote.target?.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared <= IMPACT_DISTANCE * IMPACT_DISTANCE) return { p, impact: ZODIAC_IMPACTS[species] };
  return null;
}

/** Validate a guest's ink brushstroke before the host paints it into the shared city. */
export function readCoopZodiacPaint(message, {
  remote, elapsed, lastPaintAt = -Infinity, interval = PAINT_INTERVAL,
} = {}) {
  if (message?.type !== 'zodiac-paint' || remote?.mode !== 'human') return null;
  const { species, p, scale, color } = message;
  if (typeof species !== 'string' || species !== remote.species || !Object.hasOwn(ZODIAC_INK, species)) return null;
  if (!isWorldPosition(p) || !Number.isFinite(elapsed) || !(elapsed >= lastPaintAt + interval)) return null;
  if (!Number.isFinite(message.yaw) || !Number.isFinite(scale) || scale <= 0 || scale > 4) return null;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const dx = p[0] - remote.target?.x;
  const dy = p[1] - remote.target?.y;
  const dz = p[2] - remote.target?.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  if (dx * dx + dy * dy + dz * dz > PAINT_DISTANCE * PAINT_DISTANCE) return null;
  return { species, p, yaw: message.yaw, scale, color };
}

/** Validate a single ink mark left by a guest. */
export function readCoopZodiacMark(message, { remote, elapsed, lastMarkAt = -Infinity } = {}) {
  if (message?.type !== 'zodiac-mark' || remote?.mode !== 'human') return null;
  const { species, p, radius, color } = message;
  if (typeof species !== 'string' || species !== remote.species || !Object.hasOwn(ZODIAC_INK, species)) return null;
  if (!isWorldPosition(p) || !Number.isFinite(elapsed) || !(elapsed >= lastMarkAt + PAINT_INTERVAL)) return null;
  if (!Number.isFinite(radius) || radius <= 0 || radius > 5) return null;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;

  const dx = p[0] - remote.target?.x;
  const dy = p[1] - remote.target?.y;
  const dz = p[2] - remote.target?.z;
  if (dx * dx + dy * dy + dz * dz <= PAINT_DISTANCE * PAINT_DISTANCE) return { species, p, radius, color };
  return null;
}

/** One bounded scent path replaces several independently throttled marks. */
export function readCoopZodiacScent(message, { remote, elapsed, lastScentAt = -Infinity } = {}) {
  if (message?.type !== 'zodiac-scent' || remote?.mode !== 'human' || remote.species !== 'dog') return null;
  const { p, yaw, distance, color } = message;
  if (!isWorldPosition(p) || !Number.isFinite(yaw) || !Number.isFinite(distance) || distance < 7 || distance > 42
      || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)
      || !Number.isFinite(elapsed) || !(elapsed >= lastScentAt + 0.3)) return null;
  const dx = p[0] - remote.target?.x, dy = p[1] - remote.target?.y, dz = p[2] - remote.target?.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  if (dx * dx + dy * dy + dz * dz > PAINT_DISTANCE * PAINT_DISTANCE) return null;
  return { p, yaw, distance, color };
}

/** Validate a guest's destructive ink move (wall breach or called-down comet). */
export function readCoopZodiacBurst(message, {
  remote, elapsed, lastBurstAt = -Infinity, interval = BURST_INTERVAL,
} = {}) {
  if (message?.type !== 'zodiac-burst' || remote?.mode !== 'human') return null;
  const { species, p, kind, color } = message;
  if (typeof species !== 'string' || species !== remote.species || !Object.hasOwn(ZODIAC_INK, species)) return null;
  if (!BURST_KINDS.has(kind)) return null;
  if (!isWorldPosition(p) || !Number.isFinite(elapsed) || !(elapsed >= lastBurstAt + interval)) return null;
  if (!Number.isFinite(message.yaw)) return null;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const dx = p[0] - remote.target?.x;
  const dy = p[1] - remote.target?.y;
  const dz = p[2] - remote.target?.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  if (dx * dx + dy * dy + dz * dz > BURST_DISTANCE * BURST_DISTANCE) return null;
  return { species, p, kind, yaw: message.yaw, color };
}
