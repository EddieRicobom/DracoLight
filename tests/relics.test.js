import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { forEachBuildingCell } from '../src/city-architecture.js';
import { placeRelics, RelicCollection } from '../src/relics.js';

function cityGrid(lots) {
  const cells = new Set();
  for (const lot of lots) {
    forEachBuildingCell(lot, 5, (x, y, z) => cells.add(`${lot.x / 5 + x},${y},${lot.z / 5 + z}`));
  }
  return (x, y, z) => cells.has([x, y, z].map((coordinate) => Math.floor(coordinate / 5)).join(',')) ? 0 : -1;
}

test('relic placement favors walkable buildings and uses empty interior cells', () => {
  const lots = [
    { x: 0, z: 0, w: 25, d: 25, h: 5, seed: 0.2 },
    { x: 60, z: 0, w: 30, d: 30, h: 5, seed: 0.5, shape: 'courtyard' },
    { x: 450, z: 0, w: 30, d: 30, h: 5, seed: 0.4 },
    { x: 900, z: 0, w: 50, d: 30, h: 25, seed: 0.5, shape: 'gate', landmark: true },
  ];
  const chunkAt = cityGrid(lots);
  const relics = placeRelics(lots, 5, chunkAt);
  assert.deepEqual(relics.map(({ access }) => access), ['Pátio', 'Interior', 'Passagem']);
  assert.deepEqual(relics.map(({ id }) => id).sort(), placeRelics([...lots].reverse(), 5, chunkAt).map(({ id }) => id).sort());
  for (const { x, y, z } of relics) assert.equal(chunkAt(x, y, z), -1);
  const [courtyard, interior, gate] = relics;
  for (const relic of [courtyard, gate]) {
    for (let z = relic.entryZ; z <= relic.z; z += 2.5) {
      assert.equal(chunkAt(relic.entryX, 2.5, z), -1);
    }
  }
  assert.equal(chunkAt(452.5, 2.5, interior.z), 0);
});

test('a flight sweep collects in one pass and progress survives reloads', () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const relics = [{ id: 'flight', x: 0, y: 2.5, z: 0 }, { id: 'second', x: 20, y: 2.5, z: 0 }];
  const makeCollection = () => new RelicCollection(relics, storage, () => Infinity);
  const collection = makeCollection();
  const otherTab = makeCollection();
  const first = new Vector3(0, 7, 0);
  assert.equal(collection.sweep(first, first, 0, 5.5), 1);
  assert.deepEqual([...collection.collected], ['flight']);
  const start = new Vector3(5, 7, 0), end = new Vector3(35, 7, 0);
  assert.equal(otherTab.sweep(start, end, 0, 5.5), 1);
  assert.equal(otherTab.sweep(start, end, 0, 5.5), 0);
  assert.deepEqual([...makeCollection().collected], ['flight', 'second']);
});

test('the central landmark has a walkable relic within range of the character spawn', () => {
  const lot = { x: 20, z: -70, w: 50, d: 50, h: 52, seed: 0.42, shape: 'crown', landmark: true };
  const chunkAt = cityGrid([lot]);
  const [relic] = placeRelics([lot], 5, chunkAt);
  assert.equal(relic.access, 'Entrada');
  assert.ok(Math.hypot(relic.entryX, relic.entryZ - 115) < 260);
  for (let z = relic.entryZ; z >= relic.z; z -= 2.5) {
    assert.equal(chunkAt(relic.x, 0.1, z), -1);
    assert.equal(chunkAt(relic.x, 3.4, z), -1);
  }
  assert.equal(chunkAt(relic.x, 7.5, relic.entryZ - 0.1), 0);
});

test('solid walls block pickup and storage failure leaves in-memory progress intact', () => {
  let blocked = true;
  const unavailable = () => { throw new Error('Storage disabled'); };
  const collection = new RelicCollection(
    [{ id: 'interior', x: 5.2, y: 2.5, z: 0 }],
    { getItem: unavailable, setItem: unavailable },
    () => blocked ? 0.2 : Infinity,
  );
  const feet = new Vector3(4.5, 0, 0);
  assert.equal(collection.sweep(feet, feet, 1.7, 2.7), 0);
  blocked = false;
  assert.equal(collection.sweep(feet, feet, 1.7, 2.7), 1);
  assert.equal(collection.collected.size, 1);
});
