import assert from 'node:assert/strict';
import test from 'node:test';
import { DestructionChain } from '../src/destruction-chain.js';

test('a collapse can add many points without counting as multiple bursts', () => {
  const chain = new DestructionChain();
  chain.update(20, 1, true);
  chain.update(150, 1.2, true);
  chain.update(200, 1.5, true);
  assert.equal(chain.current, 0);
  assert.equal(chain.best, 0);

  chain.update(210, 2, true);
  assert.equal(chain.current, 210);
  assert.equal(chain.best, 210);
  assert.equal(chain.seconds, 4);

  chain.update(240, 2.2, true);
  assert.equal(chain.current, 240);
  assert.equal(chain.best, 240);
});

test('inactivity expires a combo and the next hits can start a smaller one', () => {
  const chain = new DestructionChain();
  chain.update(80, 1, true);
  chain.update(90, 2, true);
  chain.update(90, 5.5, true);
  assert.equal(chain.current, 90);
  assert.equal(chain.seconds, 1);
  chain.update(100, 6, true);
  assert.equal(chain.current, 0);
  assert.equal(chain.seconds, 0);
  chain.update(101, 7, true);
  assert.equal(chain.current, 11);
  assert.equal(chain.best, 90);
});

test('reconstruction clears the current combo without erasing the record', () => {
  const chain = new DestructionChain();
  chain.update(40, 1, true);
  chain.update(50, 2, true);
  chain.reset();
  assert.equal(chain.current, 0);
  assert.equal(chain.best, 50);

  chain.update(80, 2.25, true);
  assert.equal(chain.current, 0);
  chain.update(90, 3, true);
  assert.equal(chain.current, 90);
});

test('world changes while playing as a character or guest do not join a dragon combo', () => {
  const chain = new DestructionChain();
  chain.update(20, 1, true);
  chain.update(28, 2, true);
  chain.update(80, 3, false);
  assert.equal(chain.current, 0);
  assert.equal(chain.best, 28);

  chain.update(90, 4, true);
  chain.update(100, 5, true);
  assert.equal(chain.current, 20);
  assert.equal(chain.best, 28);
});
