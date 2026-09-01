import { fft } from './fourier.js';
import type { NoteEvent } from './types.js';

/**
 * Settling the octave from the audio.
 *
 * The image says unambiguously which key is played, but not which note that is:
 * when only a section of the keyboard is in frame there is nothing to derive the
 * octave from. The layout of the keys fixes the pitch only up to a multiple of
 * an octave, and the audio has to supply the rest.
 *
 * Summing energy at the expected frequencies is not enough on its own: a guess
 * an octave too high lands on the second harmonic of the real note, where there
 * is energy as well. The score therefore subtracts the energy an octave below —
 * for the right guess there is nothing there, whereas for a guess that is too
 * high that is exactly where the real fundamental lies.
 */

export interface OctaveOptions {
  sampleRate?: number;
  /** FFT window length; a longer window resolves the bass better. */
  window?: number;
  /** How many moments of the recording to examine. */
  samples?: number;
  /** Candidate shifts in semitones. */
  candidates?: number[];
}

const DEFAULTS = {
  sampleRate: 22050,
  window: 8192,
  samples: 200,
  candidates: [-24, -12, 0, 12, 24],
} as const;

export interface OctaveResult {
  /** How many semitones to move the found notes. Zero means the image was right. */
  shift: number;
  /** By how much the winner beat the runner-up, 0..1. */
  confidence: number;
  scores: { shift: number; value: number }[];
}

function frequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Highest magnitude near a frequency; the neighbourhood absorbs slight detuning. */
function magnitudeNear(spectrum: Float64Array, hz: number, perBin: number): number {
  const center = hz / perBin;
  let max = 0;
  for (let i = Math.floor(center) - 2; i <= Math.ceil(center) + 2; i++) {
    if (i > 0 && i < spectrum.length) max = Math.max(max, spectrum[i]!);
  }
  return max;
}

export function estimateOctaveShift(
  samples: Float32Array,
  events: readonly NoteEvent[],
  options: OctaveOptions = {},
): OctaveResult {
  const sampleRate = options.sampleRate ?? DEFAULTS.sampleRate;
  const window = options.window ?? DEFAULTS.window;
  const candidates = options.candidates ?? DEFAULTS.candidates;
  const empty = { shift: 0, confidence: 0, scores: [] };
  if (events.length < 10 || samples.length < window * 2) return empty;

  // Moments are taken just after a note begins, where the fundamental is strongest.
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const step = Math.max(1, Math.floor(sorted.length / (options.samples ?? DEFAULTS.samples)));
  const moments: { time: number; pitches: number[] }[] = [];
  for (let i = 0; i < sorted.length; i += step) {
    const e = sorted[i]!;
    const time = e.start + 0.04;
    const sounding = sorted
      .filter((v) => v.start <= time && v.end > time)
      .map((v) => v.midi)
      .slice(0, 6);
    if (sounding.length > 0) moments.push({ time, pitches: sounding });
  }
  if (moments.length < 8) return empty;

  const hann = new Float64Array(window);
  for (let i = 0; i < window; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / window);
  const perBin = sampleRate / window;

  const totals = new Map<number, number>(candidates.map((c) => [c, 0]));
  const re = new Float64Array(window);
  const im = new Float64Array(window);
  let used = 0;

  for (const m of moments) {
    const start = Math.round(m.time * sampleRate);
    if (start < 0 || start + window >= samples.length) continue;
    for (let i = 0; i < window; i++) {
      re[i] = (samples[start + i] ?? 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const spectrum = new Float64Array(window / 2);
    let total = 0;
    for (let i = 0; i < window / 2; i++) {
      spectrum[i] = Math.hypot(re[i]!, im[i]!);
      total += spectrum[i]!;
    }
    if (total <= 0) continue;
    used++;

    for (const shift of candidates) {
      let score = 0;
      for (const midi of m.pitches) {
        const f = frequency(midi + shift);
        if (f < perBin * 3 || f > sampleRate / 2.5) continue;
        score += magnitudeNear(spectrum, f, perBin) - magnitudeNear(spectrum, f / 2, perBin);
      }
      totals.set(shift, totals.get(shift)! + score / total);
    }
  }

  if (used < 8) return empty;

  const scores = [...totals.entries()]
    .map(([shift, value]) => ({ shift, value: value / used }))
    .sort((a, b) => b.value - a.value);
  const winner = scores[0]!;
  const runnerUp = scores[1];
  const confidence =
    runnerUp && winner.value > 0 ? Math.max(0, (winner.value - runnerUp.value) / winner.value) : 0;

  return { shift: winner.shift, confidence, scores };
}
