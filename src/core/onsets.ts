import { fft } from './fourier.js';

/**
 * Detecting strikes in the audio by spectral flux. It serves only as a second
 * opinion: it says *when* something was played, never *what*. Pitch is read
 * from the image.
 */

export interface OnsetOptions {
  /** Sample rate of the input signal. */
  sampleRate?: number;
  /** FFT window length in samples; must be a power of two. */
  window?: number;
  /** Hop between windows in samples. */
  hop?: number;
  /** How far a peak must rise above the moving median to count as a strike. */
  sensitivity?: number;
  /** Shortest allowed distance between two strikes, in seconds. */
  minSpacing?: number;
}

const DEFAULTS = {
  sampleRate: 22050,
  window: 1024,
  hop: 256,
  sensitivity: 1.6,
  minSpacing: 0.045,
} as const;

/**
 * Spectral flux: the sum of increases in energy across frequency bands.
 * Decreases are discarded, because a decaying note is not a new strike.
 */
export function spectralFlux(
  samples: Float32Array,
  options: OnsetOptions = {},
): { flux: Float32Array; stepSeconds: number } {
  const window = options.window ?? DEFAULTS.window;
  const hop = options.hop ?? DEFAULTS.hop;
  const sampleRate = options.sampleRate ?? DEFAULTS.sampleRate;

  const hann = new Float64Array(window);
  for (let i = 0; i < window; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / window);

  const frameCount = Math.max(0, Math.floor((samples.length - window) / hop) + 1);
  const flux = new Float32Array(frameCount);
  const re = new Float64Array(window);
  const im = new Float64Array(window);
  let previous = new Float64Array(window / 2);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    for (let i = 0; i < window; i++) {
      re[i] = (samples[start + i] ?? 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    const current = new Float64Array(window / 2);
    for (let i = 0; i < window / 2; i++) {
      const magnitude = Math.hypot(re[i]!, im[i]!);
      current[i] = magnitude;
      const rise = magnitude - previous[i]!;
      if (rise > 0) sum += rise;
    }
    flux[f] = sum;
    previous = current;
  }

  return { flux, stepSeconds: hop / sampleRate };
}

function movingMedian(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  const window: number[] = [];
  for (let i = 0; i < values.length; i++) {
    window.length = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      window.push(values[j]!);
    }
    window.sort((a, b) => a - b);
    out[i] = window[window.length >> 1]!;
  }
  return out;
}

/** Times of the strikes, in seconds. */
export function findOnsets(samples: Float32Array, options: OnsetOptions = {}): number[] {
  const { flux, stepSeconds } = spectralFlux(samples, options);
  if (flux.length === 0) return [];

  const sensitivity = options.sensitivity ?? DEFAULTS.sensitivity;
  const minSpacing = options.minSpacing ?? DEFAULTS.minSpacing;
  // The threshold comes from a moving median so loud and quiet places get the
  // same chance; a fixed threshold would find nothing in a quiet stretch and
  // everything in a loud one.
  const median = movingMedian(flux, Math.round(0.3 / stepSeconds));

  const out: number[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    const v = flux[i]!;
    if (v <= flux[i - 1]! || v < flux[i + 1]!) continue;
    if (v < median[i]! * sensitivity) continue;
    const time = i * stepSeconds;
    const last = out[out.length - 1];
    if (last !== undefined && time - last < minSpacing) {
      if (v > flux[Math.round(last / stepSeconds)]!) out[out.length - 1] = time;
      continue;
    }
    out.push(time);
  }
  return out;
}

/**
 * The fraction of image strikes that found an audio strike within the tolerance,
 * and the other way round. It doubles as a measure of confidence: image and
 * audio are independent sources, so when they agree an error is unlikely.
 */
export function compareOnsets(
  fromImage: readonly number[],
  fromAudio: readonly number[],
  tolerance = 0.06,
): { coverage: number; precision: number } {
  if (fromImage.length === 0 || fromAudio.length === 0) return { coverage: 0, precision: 0 };
  const sorted = [...fromAudio].sort((a, b) => a - b);

  const nearest = (time: number): number => {
    let low = 0;
    let high = sorted.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]! < time) low = middle + 1;
      else high = middle;
    }
    let best = Math.abs(sorted[low]! - time);
    if (low > 0) best = Math.min(best, Math.abs(sorted[low - 1]! - time));
    return best;
  };

  let matched = 0;
  for (const time of fromImage) if (nearest(time) <= tolerance) matched++;

  const imageSorted = [...fromImage].sort((a, b) => a - b);
  let covered = 0;
  for (const time of sorted) {
    let best = Infinity;
    for (const i of imageSorted) {
      const d = Math.abs(i - time);
      if (d < best) best = d;
      if (i > time + tolerance) break;
    }
    if (best <= tolerance) covered++;
  }

  return { precision: matched / fromImage.length, coverage: covered / sorted.length };
}
