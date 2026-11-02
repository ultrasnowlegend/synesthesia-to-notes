import { writeMusicXml } from './notation.js';
import type { Note } from './types.js';

/**
 * A piece to try the practice screen on without a file at hand: the theme of
 * Beethoven's Ode to Joy (public domain) with a simple left hand, sixteen
 * bars in C major.
 */
export function demoScore(): string {
  const melody: [number, number][] = [
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
    [62, 1], [62, 1], [64, 1], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [64, 1], [60, 1],
    [62, 1], [64, 0.5], [65, 0.5], [64, 1], [62, 1], [60, 1], [62, 1], [55, 2],
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
  ];
  const harmony = 'CCCGCGCGGCGCCGCG';
  const chords: Record<string, number[]> = { C: [48, 55], G: [43, 55] };
  const notes: Note[] = [];
  let beat = 0;
  for (const [midi, length] of melody) {
    notes.push({ midi, beat, length, hand: 'right', velocity: 80 });
    beat += length;
  }
  [...harmony].forEach((h, bar) => {
    for (const half of [0, 2]) {
      for (const midi of chords[h]!) notes.push({ midi, beat: bar * 4 + half, length: 2, hand: 'left', velocity: 70 });
    }
  });
  return writeMusicXml(notes, { bpm: 96, offset: 0, numerator: 4, denominator: 4, fit: 1 }, 0, {
    title: 'Óda na radost',
    composer: 'Ludwig van Beethoven',
  });
}
