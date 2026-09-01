import type { Color } from './types.js';

/** A frame in raw rgb24: three bytes per pixel, rows not padded. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

export function pixel(img: Image, x: number, y: number): Color {
  const i = (y * img.width + x) * 3;
  return { r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! };
}

/** One row of the image as an array of colours. */
export function row(img: Image, y: number): Color[] {
  const out: Color[] = new Array(img.width);
  const start = y * img.width * 3;
  for (let x = 0; x < img.width; x++) {
    const i = start + x * 3;
    out[x] = { r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! };
  }
  return out;
}

/**
 * Per-pixel median of several frames. Used to obtain a resting image of the
 * keyboard: when the samples span the whole video, no key is lit in more than
 * half of them, so the median shows the bare keyboard even in a recording that
 * is never silent. Hands move and the keyboard does not, so hands vanish too.
 */
export function medianFrame(frames: readonly Image[]): Image {
  const first = frames[0];
  if (!first) throw new Error('medianFrame: no frames given');
  const n = frames.length;
  const length = first.data.length;
  const out = new Uint8Array(length);
  const buf = new Uint8Array(n);
  for (let i = 0; i < length; i++) {
    for (let s = 0; s < n; s++) buf[s] = frames[s]!.data[i]!;
    const sorted = Array.from(buf).sort((a, b) => a - b);
    out[i] = sorted[n >> 1]!;
  }
  return { width: first.width, height: first.height, data: out };
}

/**
 * Otsu's threshold over a histogram of brightness 0..255. Returns a value
 * halfway between the last background class and the first foreground one, so
 * that `value > threshold` also holds for the fractional numbers the histogram
 * was rounded from.
 */
export function otsu(values: readonly number[]): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]!++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightBackground += hist[t]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * hist[t]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const diff = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * diff * diff;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = t;
    }
  }
  return threshold + 0.5;
}

export interface Span {
  x1: number;
  x2: number;
  width: number;
  center: number;
}

/** Contiguous spans where the predicate holds. */
export function spans(length: number, holds: (x: number) => boolean): Span[] {
  const out: Span[] = [];
  let start = -1;
  for (let x = 0; x < length; x++) {
    if (holds(x)) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      out.push({ x1: start, x2: x - 1, width: x - start, center: (start + x - 1) / 2 });
      start = -1;
    }
  }
  if (start >= 0) {
    out.push({ x1: start, x2: length - 1, width: length - start, center: (start + length - 1) / 2 });
  }
  return out;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2;
}
