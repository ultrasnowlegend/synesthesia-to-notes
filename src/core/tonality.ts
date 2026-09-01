import type { Note } from './types.js';

/** Krumhansl-Kessler profiles of the major and minor keys. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Number of accidentals for a major tonic of each pitch class; negative means flats. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export interface KeySignature {
  /** Positive counts sharps, negative counts flats. */
  fifths: number;
  tonic: number;
  minor: boolean;
  /** Correlation with the profile, 0..1. */
  fit: number;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    numerator += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Estimates the key from a pitch-class histogram weighted by note length. */
export function estimateKey(notes: readonly Note[]): KeySignature {
  const histogram = new Array<number>(12).fill(0);
  for (const n of notes) histogram[n.midi % 12]! += n.length;

  let best: KeySignature = { fifths: 0, tonic: 0, minor: false, fit: 0 };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = histogram.map((_, i) => histogram[(i + tonic) % 12]!);
    for (const minor of [false, true]) {
      const fit = correlation(rotated, minor ? MINOR_PROFILE : MAJOR_PROFILE);
      if (fit > best.fit) {
        // For a minor key we use the signature of its relative major, a third up.
        const fifths = minor ? MAJOR_FIFTHS[(tonic + 3) % 12]! : MAJOR_FIFTHS[tonic]!;
        best = { fifths, tonic, minor, fit };
      }
    }
  }
  return best;
}

const SHARP_STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'] as const;
const SHARP_ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const FLAT_STEPS = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'] as const;
const FLAT_ALTERS = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

export interface SpelledPitch {
  step: string;
  /** -1 flat, 0 natural, 1 sharp. */
  alter: number;
  octave: number;
}

/** Spells a MIDI number; the direction of accidentals follows the key signature. */
export function spellPitch(midi: number, fifths: number): SpelledPitch {
  const cls = ((midi % 12) + 12) % 12;
  const flats = fifths < 0;
  const step = (flats ? FLAT_STEPS : SHARP_STEPS)[cls]!;
  const alter = (flats ? FLAT_ALTERS : SHARP_ALTERS)[cls]!;
  // C flat and B sharp would move the octave; this simplified spelling never
  // produces them.
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}
