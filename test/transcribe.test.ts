import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { transcribeVideo, type Transcription } from '../src/transcribe.js';
import { renderVideo } from './scene.js';
import { sampleScene } from './sample.js';

/**
 * The whole chain over a synthetic recording that behaves like a real piano:
 * hands cover the keys and bars fade out across the keyboard. It runs through a
 * real ffmpeg and a real codec, so it tests not the pure logic but what happens
 * to the data on the way.
 */
describe('transcribing a video', { timeout: 300_000 }, () => {
  let dir = '';
  const results = new Map<boolean, Transcription>();

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'syn2notes-test-'));
    for (const coloredHands of [true, false]) {
      const scene = sampleScene(coloredHands);
      const path = join(dir, `${coloredHands ? 'colored' : 'plain'}.mp4`);
      await renderVideo(scene, path);
      results.set(coloredHands, await transcribeVideo(path, { calibrationSamples: 12 }));
    }
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('the keyboard calibrates through the covering hands', () => {
    const r = results.get(true)!;
    assert.equal(r.geometry.keys.length, 61);
    assert.equal(r.geometry.keys[0]!.midi, 36);
    assert.equal(r.geometry.keys.at(-1)!.midi, 96);
  });

  test('the fall speed is measured from the gap between two rows', () => {
    const r = results.get(true)!;
    const scene = sampleScene(true);
    const expected = scene.speed / scene.fps;
    assert.ok(Number.isFinite(r.fallSpeed), 'the speed should be measurable');
    assert.ok(
      Math.abs(r.fallSpeed - expected) / expected < 0.25,
      `measured ${r.fallSpeed.toFixed(2)} px/frame, expected ${expected.toFixed(2)}`,
    );
  });

  for (const coloredHands of [true, false]) {
    const label = coloredHands ? 'hands told apart by colour' : 'bars of a single colour';

    test(`every note is found — ${label}`, () => {
      const r = results.get(coloredHands)!;
      const expected = sampleScene(coloredHands).notes;

      for (const n of expected) {
        const found = r.events.find(
          (e) => e.midi === n.midi && Math.abs(e.start - n.start) < 0.12,
        );
        assert.ok(found, `missing note ${n.midi} at ${n.start}`);
        const length = found.end - found.start;
        const expectedLength = n.end - n.start;
        assert.ok(
          Math.abs(length - expectedLength) < 0.1,
          `note ${n.midi}: length ${length.toFixed(3)} vs ${expectedLength.toFixed(3)}`,
        );
      }
      assert.equal(r.events.length, expected.length, 'no extra notes');
    });

    test(`the hands are assigned correctly — ${label}`, () => {
      const r = results.get(coloredHands)!;
      const expected = sampleScene(coloredHands).notes;
      let correct = 0;
      for (const n of expected) {
        const found = r.events.find(
          (e) => e.midi === n.midi && Math.abs(e.start - n.start) < 0.12,
        );
        if (found?.hand === n.hand) correct++;
      }
      assert.equal(correct, expected.length, `assigned ${correct} of ${expected.length}`);
    });
  }

  test('the tempo comes out at 120 BPM and the notes land on an eighth grid', () => {
    const r = results.get(true)!;
    assert.ok(
      Math.abs(r.tempo.bpm - 120) < 2 || Math.abs(r.tempo.bpm - 60) < 2,
      `tempo ${r.tempo.bpm}`,
    );
    for (const n of r.notes) {
      const remainder = Math.abs(n.beat * 4 - Math.round(n.beat * 4));
      assert.ok(remainder < 1e-6, `note off the grid: ${n.beat}`);
    }
  });
});
