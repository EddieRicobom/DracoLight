import assert from 'node:assert/strict';
import test from 'node:test';
import { forEachBuildingCell, landmarkAt, landmarkProxyBoxes } from '../src/city-architecture.js';

const CELL = 5;
const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function getLot(dx, dz) {
  const design = landmarkAt(30 + dx, 30 + dz, 30);
  return { x: 0, z: 0, w: design.width * CELL, d: design.depth * CELL, h: design.height, shape: design.shape, seed: 0.5 };
}

test('each landmark voxel reaches the ground through shared faces', () => {
  for (const [dx, dz] of [[0, -1], [-17, -11], [15, -14], [-12, 16], [17, 13], [-22, 4], [5, 22], [9, -23]]) {
    const lot = getLot(dx, dz);
    const cells = new Set();
    const queue = [];
    forEachBuildingCell(lot, CELL, (x, y, z) => {
      if (y === 0) queue.push([x, y, z]);
      else cells.add(`${x},${y},${z}`);
    });

    assert.ok(queue.length > 0);
    for (let i = 0; i < queue.length; i++) {
      const [x, y, z] = queue[i];
      for (const [dx, dy, dz] of DIRECTIONS) {
        const neighbor = [x + dx, y + dy, z + dz];
        if (cells.delete(neighbor.join(','))) queue.push(neighbor);
      }
    }
    assert.equal(cells.size, 0, lot.shape);
  }
});

test('gate preserves a passage in its collision voxels and distant silhouette', () => {
  const lot = getLot(-17, -11);
  const middle = lot.w / (2 * CELL);
  let startsAboveGround = false;
  forEachBuildingCell(lot, CELL, (x, y) => {
    if (x !== middle) return;
    assert.ok(y >= Math.round(lot.h * 0.74));
    startsAboveGround = true;
  });
  assert.ok(startsAboveGround);

  const spansMiddle = landmarkProxyBoxes(lot, CELL).filter(({ x, w }) =>
    Math.abs(x - lot.w / 2) < w / 2,
  );
  assert.ok(spansMiddle.length > 0);
  assert.ok(spansMiddle.every(({ y, h }) => y - h / 2 > 0));
});
