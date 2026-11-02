import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lineSlots, pageStart } from '../src/core/turning.js';

test('each line keeps its slot and the finished one gives way to the next', () => {
  assert.deepEqual(lineSlots(0, 3, 10), [0, 1, 2]);
  assert.deepEqual(lineSlots(1, 3, 10), [3, 1, 2], 'line 0 is done, line 3 takes its place');
  assert.deepEqual(lineSlots(2, 3, 10), [3, 4, 2]);
  assert.deepEqual(lineSlots(3, 3, 10), [3, 4, 5]);
});

test('at the end the finished lines stay rather than leaving gaps', () => {
  assert.deepEqual(lineSlots(9, 3, 10), [9, 7, 8]);
  assert.deepEqual(lineSlots(0, 4, 2), [0, 1, -1, -1]);
});

test('a page turns half-way through its last line and keeps that line on top', () => {
  const fits = (): number => 3;
  assert.equal(pageStart(0, 0, 0, fits, 10), 0);
  assert.equal(pageStart(0, 2, 0.2, fits, 10), 0, 'too early to turn');
  assert.equal(pageStart(0, 2, 0.6, fits, 10), 2, 'turned, line 2 now on top');
  assert.equal(pageStart(2, 3, 0, fits, 10), 2, 'and it stays until the next turn');
});

test('a page follows the player who jumped elsewhere', () => {
  const fits = (): number => 3;
  assert.equal(pageStart(0, 7, 0, fits, 10), 6);
  assert.equal(pageStart(6, 1, 0, fits, 10), 0);
});

test('the last page does not turn past the end', () => {
  const fits = (): number => 3;
  assert.equal(pageStart(6, 8, 0.9, fits, 9), 6);
});
