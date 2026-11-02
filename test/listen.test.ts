import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inharmonicity, NoteListener, partialFrequency, type Strike } from '../src/core/listen.js';
import { performance } from './piano.js';

const RATE = 48000;

/** Streams a signal through the listener in render quanta, as the window does. */
function listen(
  signal: Float32Array,
  expected: (time: number) => { due: number[]; ahead?: number[] },
): Strike[] {
  const listener = new NoteListener({ sampleRate: RATE });
  const strikes: Strike[] = [];
  for (let i = 0; i < signal.length; i += 128) {
    const e = expected(i / RATE);
    listener.setExpected(e.due, e.ahead ?? []);
    strikes.push(...listener.push(signal.subarray(i, i + 128)));
  }
  return strikes;
}

const heard = (strikes: Strike[], expected = true): number[] =>
  strikes.flatMap((s) => s.notes.filter((n) => n.expected === expected).map((n) => n.midi));

test('the partials of a piano string are stretched upwards', () => {
  assert.ok(inharmonicity(30) > inharmonicity(55), 'wound bass strings are stiffer than the middle');
  assert.ok(inharmonicity(100) > inharmonicity(60), 'short treble strings are stiffest');
  const a4 = partialFrequency(69, 1);
  assert.ok(Math.abs(a4 - 440) < 0.2, `the fundamental barely moves: ${a4}`);
  assert.ok(partialFrequency(69, 10) > 4400, 'the tenth partial lies above ten times the fundamental');
});

test('a note the score expects is heard soon after it is struck', () => {
  for (const midi of [45, 60, 72, 88]) {
    const signal = performance([[midi, 0.5, 1.2]], RATE, 2);
    const strikes = listen(signal, () => ({ due: [midi] }));
    const notes = strikes.flatMap((s) => s.notes);
    assert.deepEqual(heard(strikes), [midi], `note ${midi}`);
    const latency = notes[0]!.detectedAt - 0.5;
    assert.ok(latency > 0 && latency < 0.25, `latency of ${midi}: ${latency.toFixed(3)} s`);
  }
});

test('every note of a chord is heard', () => {
  const chord = [48, 60, 64, 67];
  const signal = performance(
    chord.map((m) => [m, 0.5, 1.5] as const),
    RATE,
    2.2,
  );
  const strikes = listen(signal, () => ({ due: chord }));
  assert.deepEqual(heard(strikes).sort((a, b) => a - b), chord);
});

test('the octave below and the octave above are not mistaken for the note', () => {
  const below = listen(performance([[60, 0.5, 1.2]], RATE, 2), () => ({ due: [72] }));
  assert.deepEqual(heard(below), [], 'C4 played, C5 expected');
  const above = listen(performance([[72, 0.5, 1.2]], RATE, 2), () => ({ due: [60] }));
  assert.deepEqual(heard(above), [], 'C5 played, C4 expected');
});

test('a note still ringing is not heard again when the next one is struck', () => {
  const signal = performance(
    [
      [60, 0.4, 2.5],
      [64, 1.2, 1.5],
      [67, 1.9, 1.0],
    ],
    RATE,
    3.2,
  );
  const strikes = listen(signal, () => ({ due: [60, 64, 67] }));
  assert.deepEqual(heard(strikes), [60, 64, 67]);
});

test('notes further ahead in the score are not heard in the current chord', () => {
  // C major now, the score continues with G and E above it.
  const signal = performance(
    [
      [48, 0.5, 1.5],
      [60, 0.5, 1.5],
      [64, 0.5, 1.5],
    ],
    RATE,
    2.2,
  );
  const strikes = listen(signal, () => ({ due: [48, 60, 64], ahead: [67, 76, 55] }));
  assert.deepEqual(heard(strikes).sort((a, b) => a - b), [48, 60, 64]);
});

test('a neighbouring key played instead of the expected one is reported as wrong', () => {
  const signal = performance([[65, 0.5, 1.2]], RATE, 2);
  const strikes = listen(signal, () => ({ due: [64] }));
  assert.deepEqual(heard(strikes), [], 'E4 was not played');
  assert.deepEqual(heard(strikes, false), [65], 'F4 was');
});

test('an empty room is silent', () => {
  const signal = performance([], RATE, 4, 0.003);
  const strikes = listen(signal, () => ({ due: [60, 64, 67], ahead: [72] }));
  assert.equal(heard(strikes).length + heard(strikes, false).length, 0);
});

test('a clap is not a note', () => {
  const signal = performance([], RATE, 2, 0.0005);
  let seed = 5;
  for (let i = 0; i < 0.03 * RATE; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    signal[Math.round(0.8 * RATE) + i]! += ((seed / 0x7fffffff) * 2 - 1) * 0.4 * Math.exp(-i / 400);
  }
  const strikes = listen(signal, () => ({ due: [60, 64, 67] }));
  assert.deepEqual(heard(strikes), []);
});
