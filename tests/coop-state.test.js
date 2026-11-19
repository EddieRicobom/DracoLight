import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoopState, readCoopZodiacImpact } from '../src/coop-state.js';
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

test('legacy and unknown ground species use Boykisser', () => {
  const ground = { ...packet, mode: 'human', id: 'guest-1' };
  for (const species of [undefined, 'boykisser', 'dragon', '__proto__', ['rabbit']]) {
    assert.equal(readCoopState({ ...ground, species }, host).species, 'boykisser');
    assert.equal(readCoopState({ ...ground, species }, guest).species, 'boykisser');
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
  assert.ok(readCoopZodiacImpact(edge, { ...impactContext, lastImpactAt: 6.5 }));
  assert.equal(readCoopZodiacImpact({ ...edge, p: [11, 45, 10] }, impactContext), null);
  assert.equal(readCoopZodiacImpact(edge, { ...impactContext, lastImpactAt: 6.501 }), null);
});
