import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findKeyboard } from '../src/core/keyboard.js';
import { writeMidi } from '../src/core/midi.js';
import { splitLength, writeMusicXml } from '../src/core/notation.js';
import { medianFrame, type Image } from '../src/core/image.js';
import { estimateTempo, quantise } from '../src/core/tempo.js';
import { estimateKey, spellPitch } from '../src/core/tonality.js';
import type { Note, NoteEvent } from '../src/core/types.js';
import { renderFrame, sceneKeys } from './scene.js';
import { sampleScene } from './sample.js';

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

test('the median of frames removes the hands and reveals a bare keyboard', () => {
  const scene = sampleScene(true);
  const frames: Image[] = [];
  for (let i = 0; i < 15; i++) {
    frames.push({
      width: scene.width,
      height: scene.height,
      data: renderFrame(scene, (scene.duration * (i + 0.5)) / 15),
    });
  }
  const background = medianFrame(frames);
  const g = findKeyboard(background);

  assert.equal(g.keys.length, 61, 'all 61 keys must be found');
  assert.equal(g.keys[0]!.midi, 36, 'the lowest key is C2');
  assert.equal(g.keys[g.keys.length - 1]!.midi, 96, 'the highest key is C7');
  assert.ok(Math.abs(g.topEdge - scene.topEdge) <= 2, `top edge ${g.topEdge}`);
  assert.ok(g.impactRow < g.topEdge, 'the impact row lies above the keyboard');
  assert.ok(g.glowRow > g.topEdge, 'the glow row lies inside the keyboard');
  assert.ok(g.depthRow > g.glowRow, 'the depth row lies deeper still');

  const expected = new Map(sceneKeys(scene).map((k) => [k.midi, (k.x1 + k.x2) / 2]));
  for (const k of g.keys) {
    const center = expected.get(k.midi);
    assert.ok(center !== undefined, `key ${k.midi} should exist`);
    assert.ok(
      Math.abs(k.center - center!) < 6,
      `centre of key ${k.midi}: ${k.center.toFixed(1)} vs ${center!.toFixed(1)}`,
    );
  }
});

test('the comb filter finds the tempo of a steady passage', () => {
  const events: NoteEvent[] = [];
  for (let i = 0; i < 24; i++) events.push(event(60 + (i % 4), 0.4 + i * 0.5, 0.45));
  const tempo = estimateTempo(events);
  assert.ok(Math.abs(tempo.bpm - 120) < 1.5, `expected 120 BPM, got ${tempo.bpm}`);
  assert.ok(tempo.fit > 0.9, `the grid should fit, fit ${tempo.fit}`);
});

test('quantisation snaps notes to the grid without shrinking them to nothing', () => {
  const events = [event(60, 0.02, 0.24), event(64, 0.51, 0.48), event(67, 1.01, 0.02)];
  const tempo = { bpm: 120, offset: 0, numerator: 4, denominator: 4, fit: 1 };
  const notes = quantise(events, tempo, { division: 4 });
  assert.equal(notes.length, 3);
  assert.deepEqual(
    notes.map((n) => [n.beat, n.length]),
    [
      [0, 0.5],
      [1, 1],
      [2, 0.25],
    ],
  );
});

test('the key signature comes from durations, not from note counts', () => {
  // G and D deliberately dominate by length, not by count: counting occurrences
  // instead of duration would send this melody to D major.
  const notes: Note[] = [
    { midi: 67, beat: 0, length: 6, hand: 'right', velocity: 80 },
    { midi: 74, beat: 6, length: 3, hand: 'right', velocity: 80 },
    { midi: 71, beat: 9, length: 3, hand: 'right', velocity: 80 },
    { midi: 69, beat: 12, length: 2, hand: 'right', velocity: 80 },
    { midi: 64, beat: 14, length: 2, hand: 'right', velocity: 80 },
    { midi: 60, beat: 16, length: 2, hand: 'right', velocity: 80 },
    { midi: 66, beat: 18, length: 1.5, hand: 'right', velocity: 80 },
    { midi: 61, beat: 19.5, length: 0.25, hand: 'right', velocity: 80 },
  ];
  const key = estimateKey(notes);
  assert.equal(key.fifths, 1, 'G major has one sharp');
  assert.equal(spellPitch(66, 1).step, 'F');
  assert.equal(spellPitch(66, 1).alter, 1);
  assert.equal(spellPitch(70, -2).step, 'B');
  assert.equal(spellPitch(70, -2).alter, -1);
});

test('lengths break down into writable note values', () => {
  assert.deepEqual(splitLength(24).map((v) => v.type), ['quarter']);
  assert.deepEqual(splitLength(36).map((v) => [v.type, v.dots]), [['quarter', 1]]);
  assert.deepEqual(splitLength(8), [{ divisions: 8, type: 'eighth', dots: 0, triplet: true }]);
  const split = splitLength(30);
  assert.deepEqual(split.map((v) => v.type), ['quarter', '16th']);
  assert.equal(split.reduce((s, v) => s + v.divisions, 0), 30);
});

test('MusicXML has two staves and the right number of bars', () => {
  const notes: Note[] = [
    { midi: 72, beat: 0, length: 1, hand: 'right', velocity: 80 },
    { midi: 48, beat: 0, length: 2, hand: 'left', velocity: 80 },
    { midi: 74, beat: 4.5, length: 0.5, hand: 'right', velocity: 80 },
  ];
  const xml = writeMusicXml(notes, { bpm: 120, offset: 0, numerator: 4, denominator: 4, fit: 1 }, 0);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign>/);
  assert.equal((xml.match(/<measure number=/g) ?? []).length, 2);
  assert.match(xml, /<divisions>24<\/divisions>/);
});

test('the MIDI file has a header and three tracks', () => {
  const data = writeMidi(
    [
      { midi: 60, beat: 0, length: 1, hand: 'right', velocity: 80 },
      { midi: 48, beat: 0, length: 2, hand: 'left', velocity: 70 },
    ],
    { bpm: 96, offset: 0, numerator: 3, denominator: 4, fit: 1 },
    -2,
  );
  assert.deepEqual([...data.subarray(0, 4)], [0x4d, 0x54, 0x68, 0x64]);
  const text = Buffer.from(data).toString('latin1');
  assert.equal(text.split('MTrk').length - 1, 3, 'a control track and two hands');
  assert.equal(data[11], 3, 'the header announces three tracks');
});

test('legato fills a short gap instead of writing a rest', () => {
  const notes: Note[] = [
    { midi: 72, beat: 0, length: 0.25, hand: 'right', velocity: 80 },
    { midi: 74, beat: 1, length: 0.25, hand: 'right', velocity: 80 },
  ];
  const tempo = { bpm: 120, offset: 0, numerator: 4, denominator: 4, fit: 1 };

  const literal = writeMusicXml(notes, tempo, 0, { legato: 0 });
  const joined = writeMusicXml(notes, tempo, 0, { legato: 1 });

  assert.ok(
    (literal.match(/<rest\/>/g) ?? []).length > (joined.match(/<rest\/>/g) ?? []).length,
    'legato should lower the number of rests',
  );
  assert.match(joined, /<duration>24<\/duration>/, 'the first note stretches over a whole beat');
});

test('a low note of the right hand is engraved in the bass clef', () => {
  const notes: Note[] = [
    { midi: 40, beat: 0, length: 1, hand: 'right', velocity: 80 },
    { midi: 84, beat: 1, length: 1, hand: 'left', velocity: 80 },
  ];
  const xml = writeMusicXml(notes, { bpm: 120, offset: 0, numerator: 4, denominator: 4, fit: 1 }, 0, {
    splitPoint: 60,
  });
  const bar = xml.slice(xml.indexOf('<measure number="1"'), xml.indexOf('<measure number="2"'));
  const low = bar.slice(bar.indexOf('<octave>2</octave>'));
  assert.match(low.slice(0, 400), /<staff>2<\/staff>/, 'E2 belongs to the bass staff');
  const high = bar.slice(bar.indexOf('<octave>6</octave>'));
  assert.match(high.slice(0, 400), /<staff>1<\/staff>/, 'C6 belongs to the treble staff');
});
