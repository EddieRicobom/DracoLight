import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCoopState, readCoopZodiacImpact, readCoopZodiacPaint, readCoopZodiacMark, readCoopZodiacScent, readCoopZodiacBurst,
} from '../src/coop-state.js';
import { ZODIAC_IMPACTS } from '../src/zodiac-abilities.js';

const host = { role: 'host', peerId: 'guest-1', selfId: 'host' };
const guest = { role: 'guest', peerId: 'host', selfId: 'guest-2' };
const packet = { type: 'state', id: 'host', mode: 'dragon', p: [1, 2, 3], yaw: 0 };

test('host attributes player state to the sending guest and relays their selected species', () => {
  const state = readCoopState({ ...packet, species: 'rabbit', speed: 30, motion: 'run' }, host);
  assert.equal(state.id, 'guest-1');
  assert.equal(state.mode, 'human');
  assert.equal(state.species, 'rabbit');
  assert.equal(state.speed, 30);
  assert.equal(state.motion, 'run');
  assert.deepEqual(readCoopState(state, guest), state);
});

test('guests render the host as dragon and other players as ground characters', () => {
  const hostState = readCoopState({ ...packet, mode: 'human', species: 'rabbit' }, guest);
  assert.equal(hostState.mode, 'dragon');
  assert.equal(Object.hasOwn(hostState, 'species'), false);
  const otherState = readCoopState({ ...packet, id: 'guest-1', species: 'tiger' }, guest);
  assert.equal(otherState.mode, 'human');
  assert.equal(otherState.species, 'tiger');
  assert.equal(readCoopState({ ...packet, id: 'guest-2' }, guest), null);
});

test('legacy and unknown ground species use the rat', () => {
  const ground = { ...packet, mode: 'human', id: 'guest-1' };
  for (const species of [undefined, 'boykisser', 'dragon', '__proto__', ['rabbit']]) {
    assert.equal(readCoopState({ ...ground, species }, host).species, 'rat');
    assert.equal(readCoopState({ ...ground, species }, guest).species, 'rat');
  }
});

test('rejects invalid movement and bounds optional movement fields', () => {
  for (const malformed of [{ p: [0, 0, 30000] }, { p: [1, 2, '3'] }, { yaw: Infinity }, { mode: 'other' }]) {
    assert.equal(readCoopState({ ...packet, ...malformed }, host), null);
  }
  const state = readCoopState({ ...packet, pitch: -2, speed: 9999, motion: [], color: '#xyzxyz' }, guest);
  assert.equal(state.pitch, -1.35);
  assert.equal(state.speed, 5000);
  assert.equal(state.motion, 'idle');
  assert.equal(state.color, '#ef4444');
});

const impactPacket = { type: 'zodiac-impact', species: 'ox', p: [10, 0, 25] };
const impactContext = { remote: { mode: 'human', species: 'ox', target: { x: 10, y: 0, z: 10 } }, elapsed: 7 };

test('accepts a nearby impact and supplies the host damage parameters', () => {
  const message = { ...impactPacket, radius: 999, power: 999, maxChunks: 999 };
  assert.deepEqual(readCoopZodiacImpact(message, impactContext), { p: impactPacket.p, impact: ZODIAC_IMPACTS.ox });
});

test('rejects malformed and out-of-world impact coordinates', () => {
  for (const p of [null, { x: 10, y: 0, z: 25 }, [10, 0], Array(3), ['10', 0, 25], [10, Infinity, 25], [30000, 0, 25]]) {
    assert.equal(readCoopZodiacImpact({ ...impactPacket, p }, impactContext), null);
  }
});

test('requires the connected guest to be playing the requested destructive species', () => {
  assert.equal(readCoopZodiacImpact({ ...impactPacket, species: 'tiger' }, impactContext), null);
  for (const species of ['rabbit', 'boykisser', '__proto__']) {
    const remote = { ...impactContext.remote, species };
    assert.equal(readCoopZodiacImpact({ ...impactPacket, species }, { ...impactContext, remote }), null);
  }
  assert.equal(readCoopZodiacImpact(impactPacket, { ...impactContext, remote: undefined }), null);
  assert.equal(readCoopZodiacImpact(impactPacket, { ...impactContext, remote: { ...impactContext.remote, mode: 'dragon' } }), null);
});

test('checks three-dimensional distance and the host impact interval', () => {
  const edge = { ...impactPacket, p: [10, 45, 10] };
  assert.ok(readCoopZodiacImpact(edge, { ...impactContext, lastImpactAt: 6.94 }));
  assert.ok(readCoopZodiacImpact(edge, { ...impactContext, lastImpactAt: 6.95 }));
  assert.equal(readCoopZodiacImpact({ ...edge, p: [11, 45, 10] }, impactContext), null);
  assert.equal(readCoopZodiacImpact(edge, { ...impactContext, lastImpactAt: 6.96 }), null);
});

test('a guest animal relays animation and facing with a compatible legacy fallback', () => {
  const state = readCoopState({ ...packet, species: 'rooster', yaw: 1, facingYaw: 2, verticalSpeed: -900, ability: true }, host);
  assert.equal(state.facingYaw, 2);
  assert.equal(state.verticalSpeed, -300);
  assert.equal(state.ability, true);
  assert.deepEqual(readCoopState(state, guest), state);
  const legacy = readCoopState({ ...packet, species: 'rabbit', yaw: 1 }, host);
  assert.equal(legacy.facingYaw, 1);
  assert.equal(legacy.verticalSpeed, 0);
  assert.equal(legacy.ability, false);
});

const paintPacket = {
  type: 'zodiac-paint', species: 'rabbit', p: [10, 0.7, 25], yaw: 0.5, scale: 1.2, color: '#ef4444',
};
const paintContext = { remote: { mode: 'human', species: 'rabbit', target: { x: 10, y: 0, z: 20 } }, elapsed: 7 };

test('dog scent path is bounded and accepted as a single cooperative event', () => {
  const message = { type: 'zodiac-scent', p: [10, 0, 20], yaw: 0.5, distance: 42, color: '#ef4444' };
  const context = { remote: { mode: 'human', species: 'dog', target: { x: 10, y: 0, z: 20 } }, elapsed: 7 };
  assert.deepEqual(readCoopZodiacScent(message, context), { p: message.p, yaw: 0.5, distance: 42, color: '#ef4444' });
  assert.ok(readCoopZodiacScent(message, { ...context, lastScentAt: 6.7 }));
  assert.equal(readCoopZodiacScent({ ...message, distance: 43 }, context), null);
  assert.equal(readCoopZodiacScent(message, { ...context, lastScentAt: 6.8 }), null);
  assert.equal(readCoopZodiacScent(message, { ...context, remote: { mode: 'human', species: 'dog' } }), null);
  assert.equal(readCoopZodiacScent(message, { ...context, remote: { ...context.remote, species: 'rabbit' } }), null);
});

test('accepts a nearby guest brushstroke with its own colour and size', () => {
  assert.deepEqual(readCoopZodiacPaint(paintPacket, paintContext), {
    species: 'rabbit', p: [10, 0.7, 25], yaw: 0.5, scale: 1.2, color: '#ef4444',
  });
  assert.ok(readCoopZodiacPaint({ ...paintPacket, scale: 2.6 }, paintContext));
  assert.ok(readCoopZodiacPaint(paintPacket, { ...paintContext, lastPaintAt: 6.9 }));
});

const markPacket = {
  type: 'zodiac-mark', species: 'rabbit', p: [10, 80, 20], radius: 5, color: '#eF4444',
};

test('accepts a guest mark at the radius, distance and time limits', () => {
  const { species, p, radius, color } = markPacket;
  assert.deepEqual(readCoopZodiacMark(markPacket, { ...paintContext, lastMarkAt: 6.9 }),
    { species, p, radius, color });
  assert.ok(readCoopZodiacMark(markPacket, paintContext));
});

test('rejects malformed, distant and overfrequent guest marks', () => {
  const malformed = [
    { type: 'zodiac-paint' }, { species: 'ox' }, { radius: 0 }, { radius: -1 }, { radius: 5.01 },
    { radius: Infinity }, { radius: '5' }, { color: 'red' }, { color: '#xyzxyz' },
    { p: [11, 80, 20] }, { p: [10, 80] }, { p: [Infinity, 0, 20] },
  ];
  for (const fields of malformed) assert.equal(readCoopZodiacMark({ ...markPacket, ...fields }, paintContext), null);
  assert.equal(readCoopZodiacMark(markPacket, { ...paintContext, lastMarkAt: 6.901 }), null);
  assert.equal(readCoopZodiacMark(markPacket, { ...paintContext, elapsed: NaN }), null);
  for (const remote of [null, { ...paintContext.remote, mode: 'dragon' }, { ...paintContext.remote, target: null }]) {
    assert.equal(readCoopZodiacMark(markPacket, { ...paintContext, remote }), null);
  }
});

const burstPacket = {
  type: 'zodiac-burst', species: 'rabbit', kind: 'breach', p: [10, 2, 25], yaw: 0.5, color: '#ef4444',
};
const burstContext = { remote: { mode: 'human', species: 'rabbit', target: { x: 10, y: 0, z: 20 } }, elapsed: 7 };

test('accepts guest wall breaches and comets near the sending character', () => {
  assert.deepEqual(readCoopZodiacBurst(burstPacket, burstContext), {
    species: 'rabbit', kind: 'breach', p: [10, 2, 25], yaw: 0.5, color: '#ef4444',
  });
  assert.ok(readCoopZodiacBurst({ ...burstPacket, kind: 'comet' }, burstContext));
  assert.ok(readCoopZodiacBurst(burstPacket, { ...burstContext, elapsed: 1, lastBurstAt: 0.8 }));
});

test('rejects unknown burst kinds, distant targets and malformed fields', () => {
  assert.equal(readCoopZodiacBurst({ ...burstPacket, kind: 'nuke' }, burstContext), null);
  assert.equal(readCoopZodiacBurst({ ...burstPacket, species: 'ox' }, burstContext), null);
  assert.equal(readCoopZodiacBurst({ ...burstPacket, yaw: NaN }, burstContext), null);
  assert.equal(readCoopZodiacBurst({ ...burstPacket, color: 'blue' }, burstContext), null);
  assert.equal(readCoopZodiacBurst({ ...burstPacket, p: [10, 2, 300] }, burstContext), null);
  assert.equal(readCoopZodiacBurst(burstPacket, { ...burstContext, lastBurstAt: 6.9 }), null);
  assert.equal(readCoopZodiacBurst(burstPacket, { ...burstContext, remote: { ...burstContext.remote, mode: 'dragon' } }), null);
});

test('rejects mismatched, malformed or overfrequent guest paint', () => {
  assert.equal(readCoopZodiacPaint({ ...paintPacket, type: 'paint' }, paintContext), null);
  assert.equal(readCoopZodiacPaint(paintPacket, { ...paintContext, remote: { ...paintContext.remote, mode: 'dragon' } }), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, species: 'ox' }, paintContext), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, yaw: Infinity }, paintContext), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, scale: 0 }, paintContext), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, scale: 5 }, paintContext), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, color: 'red' }, paintContext), null);
  assert.equal(readCoopZodiacPaint({ ...paintPacket, p: [10, 0, 300] }, paintContext), null);
  assert.equal(readCoopZodiacPaint(paintPacket, { ...paintContext, lastPaintAt: 6.95 }), null);
});
