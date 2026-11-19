import { ZODIAC_IMPACTS } from './zodiac-abilities.js';
import { isZodiacSpecies } from './zodiac-species.js';

const DEFAULT_SPECIES = 'boykisser';
const MOTIONS = new Set(['idle', 'walk', 'run', 'climb', 'air']);
const IMPACT_DISTANCE = 45;
const IMPACT_INTERVAL = 0.5;

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
  }
  return state;
}

export function readCoopZodiacImpact(message, { remote, elapsed, lastImpactAt = -Infinity }) {
  if (message?.type !== 'zodiac-impact' || remote?.mode !== 'human') return null;
  const { species, p } = message;
  if (typeof species !== 'string' || species !== remote.species || !Object.hasOwn(ZODIAC_IMPACTS, species)) return null;
  if (!isWorldPosition(p) || !Number.isFinite(elapsed) || elapsed - lastImpactAt < IMPACT_INTERVAL) return null;

  const dx = p[0] - remote.target?.x;
  const dy = p[1] - remote.target?.y;
  const dz = p[2] - remote.target?.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared <= IMPACT_DISTANCE * IMPACT_DISTANCE) return { p, impact: ZODIAC_IMPACTS[species] };
  return null;
}
