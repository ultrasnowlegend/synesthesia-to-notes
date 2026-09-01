import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareNotes } from '../src/core/evaluation.js';
import { writeMidi } from '../src/core/midi.js';
import { readMidi } from '../src/core/midiRead.js';
import { estimateOctaveShift } from '../src/core/octave.js';
import type { Note, NoteEvent } from '../src/core/types.js';

function event(midi: number, start: number, length: number): NoteEvent {
  return {
    midi,
    start,
    end: start + length,
    hand: 'unknown',
    color: { r: 0, g: 0, b: 0 },
    confidence: 1,
  };
}

/** A tone with a few harmonics, roughly the way a piano sounds. */
function addTone(
  target: Float32Array,
  midi: number,
  start: number,
  length: number,
  sampleRate: number,
): void {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const from = Math.round(start * sampleRate);
  const to = Math.min(target.length, Math.round((start + length) * sampleRate));
  for (let i = from; i < to; i++) {
    const t = (i - from) / sampleRate;
    const decay = Math.exp(-t * 2.5);
    target[i] =
      target[i]! +
      decay *
        (Math.sin(2 * Math.PI * f * t) +
          0.45 * Math.sin(4 * Math.PI * f * t) +
          0.2 * Math.sin(6 * Math.PI * f * t));
  }
}

test('a MIDI file reads back the way it was written', () => {
  const notes: Note[] = [
    { midi: 60, beat: 0, length: 1, hand: 'right', velocity: 80 },
    { midi: 64, beat: 1, length: 0.5, hand: 'right', velocity: 90 },
    { midi: 43, beat: 0, length: 2, hand: 'left', velocity: 70 },
  ];
  const tempo = { bpm: 120, offset: 0, numerator: 4, denominator: 4, fit: 1 };
  const read = readMidi(writeMidi(notes, tempo, 0));

  assert.equal(read.notes.length, 3);
  assert.ok(Math.abs(read.bpm - 120) < 0.01, `tempo ${read.bpm}`);
  assert.deepEqual(
    [...read.notes].sort((a, b) => a.midi - b.midi).map((n) => n.midi),
    [43, 60, 64],
  );
  const e = read.notes.find((n) => n.midi === 64)!;
  // At 120 BPM a beat is half a second.
  assert.ok(Math.abs(e.start - 0.5) < 0.01, `start ${e.start}`);
  assert.ok(Math.abs(e.end - e.start - 0.25) < 0.01, `length ${e.end - e.start}`);
});

test('comparing notes counts only what matches in both pitch and time', () => {
  const reference = [
    { midi: 60, start: 0 },
    { midi: 64, start: 1 },
    { midi: 67, start: 2 },
  ];
  const found = [
    { midi: 60, start: 0.02 },
    { midi: 63, start: 1.0 },
    { midi: 67, start: 2.3 },
    { midi: 72, start: 3 },
  ];
  const s = compareNotes(found, reference, 0.05);
  assert.equal(s.matched, 1, 'only the first note matches');
  assert.equal(s.found, 4);
  assert.equal(s.reference, 3);
  assert.ok(Math.abs(s.precision - 0.25) < 1e-9);
});

test('the audio settles the octave when the image guesses wrong', { timeout: 120_000 }, () => {
  const sampleRate = 22050;
  const actual = [60, 64, 67, 72, 65, 69, 62, 59, 55, 71, 57, 63, 68, 61, 66, 70];
  const samples = new Float32Array(sampleRate * (actual.length + 2));
  const events: NoteEvent[] = [];
  for (let i = 0; i < actual.length; i++) {
    const start = 0.5 + i;
    addTone(samples, actual[i]!, start, 0.9, sampleRate);
    events.push(event(actual[i]!, start, 0.9));
  }

  const correct = estimateOctaveShift(samples, events, { sampleRate });
  assert.equal(correct.shift, 0, 'with the right pitches there is nothing to shift');

  // The same audio, but the image read the pitches an octave too low.
  const tooLow = events.map((e) => ({ ...e, midi: e.midi - 12 }));
  assert.equal(
    estimateOctaveShift(samples, tooLow, { sampleRate }).shift,
    12,
    'it should notice an octave is missing upwards',
  );

  const tooHigh = events.map((e) => ({ ...e, midi: e.midi + 12 }));
  assert.equal(
    estimateOctaveShift(samples, tooHigh, { sampleRate }).shift,
    -12,
    'and equally in the other direction',
  );
});
