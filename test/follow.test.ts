import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScoreFollower, type ScoreStep } from '../src/core/follow.js';

/** Steps from a compact description: each entry is the pitches of one step, staff 1. */
function score(...chords: (number | number[])[]): ScoreStep[] {
  return chords.map((c, i) => ({
    beat: i,
    time: i * 500,
    system: Math.floor(i / 4),
    notes: (Array.isArray(c) ? c : [c]).map((midi, j) => ({
      id: `${i}.${j}`,
      midi,
      staff: midi >= 60 ? 1 : 2,
    })),
  }));
}

test('playing the score in order marks every note and reaches the end', () => {
  const f = new ScoreFollower(score(60, 62, [64, 48], 65));
  let t = 0;
  for (const m of [60, 62, 64, 48, 65]) f.play(m, (t += 0.3));
  assert.ok(f.finished);
  assert.deepEqual(f.stats(), { hit: 5, missed: 0, wrong: 0, total: 5 });
});

test('a chord from a keyboard waits for all its notes', () => {
  const f = new ScoreFollower(score([60, 64, 67], 72));
  f.play(60, 1);
  f.play(64, 1.01);
  assert.equal(f.position, 0, 'two of three notes are not enough');
  f.play(67, 1.02);
  assert.equal(f.position, 1);
});

test('moving on leaves the unplayed notes missed once their grace runs out', () => {
  const f = new ScoreFollower(score([60, 64], 67, 69));
  f.play(60, 1);
  f.play(67, 1.5);
  assert.equal(f.position, 2, 'the next step is taken at once');
  assert.equal(f.state('0.1'), 'pending', 'the missing note may still come');
  f.tick(3);
  assert.equal(f.state('0.1'), 'missed');
  assert.equal(f.state('1.0'), 'hit');
});

test('a late note of a chord still lands in its chord', () => {
  const f = new ScoreFollower(score([60, 64, 67], 72), { input: 'audio' });
  f.hear({ time: 1, notes: [{ midi: 60, expected: true }, { midi: 64, expected: true }] }, 1.1);
  assert.equal(f.position, 1, 'most of a chord is enough through a microphone');
  f.hear({ time: 1, notes: [{ midi: 67, expected: true }] }, 1.2);
  assert.equal(f.state('0.2'), 'hit');
});

test('one stray note does not throw the finger forward, two in a row do', () => {
  const f = new ScoreFollower(score(60, 62, 64, 65, 67, 69));
  f.play(60, 1);
  f.play(65, 2);
  assert.equal(f.position, 1, 'a single note further on only raises a suspicion');
  f.play(67, 2.4);
  assert.equal(f.position, 5, 'the second confirms the jump');
  assert.equal(f.state('3.0'), 'hit');
  assert.equal(f.state('4.0'), 'hit');
});

test('a note far from the finger is a wrong note', () => {
  const f = new ScoreFollower(score(60, 62, 64));
  const change = f.play(61, 1);
  assert.equal(change.wrong, 61);
  assert.equal(f.stats().wrong, 1);
  assert.equal(f.position, 0);
});

test('repeating what was just played is not a mistake', () => {
  const f = new ScoreFollower(score(60, 62, 64, 65));
  f.play(60, 1);
  f.play(62, 1.3);
  const again = f.play(62, 1.6);
  assert.equal(again.wrong, undefined);
  assert.equal(f.position, 2);
});

test('practising one hand greys the other out and does not wait for it', () => {
  const f = new ScoreFollower(score([60, 48], 50, 62), { staves: [1] });
  assert.equal(f.state('0.1'), 'skipped');
  f.play(60, 1);
  assert.equal(f.position, 2, 'the step with only the left hand passes by itself');
  assert.equal(f.state('1.0'), 'skipped');
  assert.deepEqual(f.expected().due, [62]);
});

test('the listener is told what is due and what lies ahead', () => {
  const f = new ScoreFollower(score([60, 64], 62, 65, 67, 69), { lookahead: 2 });
  const e = f.expected();
  assert.deepEqual(e.due.sort(), [60, 64]);
  assert.deepEqual(e.ahead.sort(), [62, 65]);
});

test('a microphone strike moves the finger by one step at most', () => {
  // The chord C-E and the next note E sound in one strike: the E is the chord's.
  const f = new ScoreFollower(score([60, 64], 64, 67), { input: 'audio' });
  f.hear({ time: 1, notes: [{ midi: 60, expected: true }, { midi: 64, expected: true }] }, 1.1);
  assert.equal(f.position, 1);
  assert.equal(f.state('1.0'), 'pending');
});

test('a player who goes back to repeat a phrase is found again', () => {
  const f = new ScoreFollower(score(60, 62, 64, 65, 67, 69, 71, 72));
  let t = 0;
  for (const m of [60, 62, 64, 65, 67, 69]) f.play(m, (t += 0.3));
  assert.equal(f.position, 6);
  for (const m of [62, 64, 65, 67]) f.play(m, (t += 0.3));
  assert.ok(f.position >= 4 && f.position <= 5, `the finger follows back: ${f.position}`);
});

test('seeking starts over from a chosen step', () => {
  const f = new ScoreFollower(score(60, 62, 64, 65));
  f.play(60, 1);
  f.play(62, 1.2);
  f.seek(1);
  assert.equal(f.position, 1);
  assert.equal(f.state('0.0'), 'hit', 'what lies before stays');
  assert.equal(f.state('1.0'), 'pending', 'what lies after is unplayed again');
});
