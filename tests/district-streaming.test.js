import test from 'node:test';
import assert from 'node:assert/strict';
import { streamingDistrictIndex } from '../src/district-streaming.js';

const districts = { origin: -2700, width: 900, count: 6, margin: 90 };
const indexAt = (position, previousIndex) => streamingDistrictIndex(position, previousIndex, districts);

test('loose boundary holds the previous district while crossing back and forth', () => {
  let index = indexAt(3);
  assert.equal(index, 3);
  for (const position of [-3, 3, -89.99, 89.99, -90]) {
    index = indexAt(position, index);
    assert.equal(index, 3);
  }
  index = indexAt(-90.01, index);
  assert.equal(index, 2);
  assert.equal(indexAt(89.99, index), 2);
  assert.equal(indexAt(90, index), 3);
});

test('long jumps immediately pick their destination and clamp outside the city', () => {
  assert.equal(indexAt(1810, 0), 5);
  assert.equal(indexAt(-1810, 5), 0);
  assert.equal(indexAt(-920, 5), 1);
  assert.equal(indexAt(10000, 2), 5);
  assert.equal(indexAt(-10000, 3), 0);
  assert.equal(indexAt(10000), 5);
  assert.equal(indexAt(-10000), 0);
});
