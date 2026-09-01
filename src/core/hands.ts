import { colorDistance } from './color.js';
import { median } from './image.js';
import type { Color, HandTracks, KeyboardGeometry, NoteEvent } from './types.js';

/**
 * A shrunken strip of the keyboard, frame by frame. What we look for in it are
 * two large blobs, not detail, so 320 x 24 px is ample and the whole strip fits
 * in memory.
 */
export interface KeyboardStrip {
  width: number;
  height: number;
  frameCount: number;
  /** rgb24, frame by frame: ((frame * height + y) * width + x) * 3. */
  data: Uint8Array;
  /** x in the source video = offsetX + x * scale. */
  offsetX: number;
  scale: number;
}

export interface HandOptions {
  /** Fraction of a column's rows that must differ for a hand to be there. */
  occupancyThreshold?: number;
  /** The narrowest blob still taken for a hand, in strip pixels. */
  minWidth?: number;
  /** Window length of the moving average used to smooth the occupancy. */
  smoothing?: number;
}

const DEFAULTS = { occupancyThreshold: 0.3, minWidth: 5, smoothing: 5 } as const;

function pixel(strip: KeyboardStrip, frame: number, x: number, y: number): Color {
  const i = ((frame * strip.height + y) * strip.width + x) * 3;
  return { r: strip.data[i]!, g: strip.data[i + 1]!, b: strip.data[i + 2]! };
}

/** The resting strip: in every pixel it is the keyboard most of the time, not a hand. */
export function stripBackground(strip: KeyboardStrip, samples = 200): Uint8Array {
  const step = Math.max(1, Math.floor(strip.frameCount / samples));
  const frames: number[] = [];
  for (let f = 0; f < strip.frameCount; f += step) frames.push(f);

  const size = strip.width * strip.height * 3;
  const out = new Uint8Array(size);
  const buf: number[] = new Array(frames.length);
  for (let i = 0; i < size; i++) {
    for (let s = 0; s < frames.length; s++) {
      buf[s] = strip.data[frames[s]! * size + i]!;
    }
    out[i] = median(buf);
  }
  return out;
}

/** Fraction of changed pixels in every column of the strip, frame by frame. */
export function columnOccupancy(
  strip: KeyboardStrip,
  background: Uint8Array,
  colorThreshold = 0.12,
): Float32Array {
  const out = new Float32Array(strip.frameCount * strip.width);
  for (let f = 0; f < strip.frameCount; f++) {
    for (let x = 0; x < strip.width; x++) {
      let changed = 0;
      for (let y = 0; y < strip.height; y++) {
        const j = (y * strip.width + x) * 3;
        const resting: Color = { r: background[j]!, g: background[j + 1]!, b: background[j + 2]! };
        if (colorDistance(pixel(strip, f, x, y), resting) > colorThreshold) changed++;
      }
      out[f * strip.width + x] = changed / strip.height;
    }
  }
  return out;
}

function movingAverage(
  values: Float32Array,
  from: number,
  length: number,
  window: number,
): Float32Array {
  const out = new Float32Array(length);
  const half = window >> 1;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -half; d <= half; d++) {
      const j = i + d;
      if (j >= 0 && j < length) {
        sum += values[from + j]!;
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

interface Blob {
  from: number;
  to: number;
  center: number;
  mass: number;
}

function blobs(profile: Float32Array, threshold: number, minWidth: number): Blob[] {
  const out: Blob[] = [];
  let from = -1;
  for (let x = 0; x <= profile.length; x++) {
    const above = x < profile.length && profile[x]! > threshold;
    if (above && from < 0) from = x;
    if (!above && from >= 0) {
      const to = x - 1;
      if (to - from + 1 >= minWidth) {
        let mass = 0;
        let weighted = 0;
        for (let i = from; i <= to; i++) {
          mass += profile[i]!;
          weighted += profile[i]! * i;
        }
        out.push({ from, to, center: weighted / mass, mass });
      }
      from = -1;
    }
  }
  return out;
}

/**
 * Two hand tracks over time. When they merge into a single blob it is split at
 * its middle; when they disappear entirely the value stays undefined and is
 * filled in afterwards from the surrounding frames. The hands are never allowed
 * to swap sides.
 */
export function trackHands(strip: KeyboardStrip, options: HandOptions = {}): HandTracks {
  const threshold = options.occupancyThreshold ?? DEFAULTS.occupancyThreshold;
  const minWidth = options.minWidth ?? DEFAULTS.minWidth;
  const window = options.smoothing ?? DEFAULTS.smoothing;

  const background = stripBackground(strip);
  const occupancy = columnOccupancy(strip, background);
  const x = new Float32Array(strip.frameCount * 2).fill(NaN);

  const typicalWidth = median(
    (() => {
      const widths: number[] = [];
      const step = Math.max(1, Math.floor(strip.frameCount / 200));
      for (let f = 0; f < strip.frameCount; f += step) {
        const profile = movingAverage(occupancy, f * strip.width, strip.width, window);
        for (const b of blobs(profile, threshold, minWidth)) widths.push(b.to - b.from + 1);
      }
      return widths.length ? widths : [minWidth * 2];
    })(),
  );

  for (let f = 0; f < strip.frameCount; f++) {
    const profile = movingAverage(occupancy, f * strip.width, strip.width, window);
    const found = blobs(profile, threshold, minWidth);

    if (found.length >= 2) {
      const two = [...found].sort((a, b) => b.mass - a.mass).slice(0, 2);
      two.sort((a, b) => a.center - b.center);
      x[f * 2] = two[0]!.center;
      x[f * 2 + 1] = two[1]!.center;
    } else if (found.length === 1) {
      const b = found[0]!;
      const width = b.to - b.from + 1;
      if (width > typicalWidth * 1.7) {
        // The hands touched and merged into one blob; split it in the middle.
        x[f * 2] = (b.from + b.center) / 2;
        x[f * 2 + 1] = (b.center + b.to) / 2;
      } else {
        const previousLeft = f > 0 ? x[(f - 1) * 2]! : NaN;
        const previousRight = f > 0 ? x[(f - 1) * 2 + 1]! : NaN;
        const toLeft = Number.isFinite(previousLeft) ? Math.abs(b.center - previousLeft) : Infinity;
        const toRight = Number.isFinite(previousRight)
          ? Math.abs(b.center - previousRight)
          : Infinity;
        if (toLeft <= toRight) x[f * 2] = b.center;
        else x[f * 2 + 1] = b.center;
      }
    }
  }

  fillGaps(x, strip.frameCount);
  for (let f = 0; f < strip.frameCount; f++) {
    const left = x[f * 2]!;
    const right = x[f * 2 + 1]!;
    if (Number.isFinite(left) && Number.isFinite(right) && left > right) {
      x[f * 2] = right;
      x[f * 2 + 1] = left;
    }
    // Convert to source coordinates only at the end, so the smoothing above
    // happens in strip units.
    x[f * 2] = strip.offsetX + x[f * 2]! * strip.scale;
    x[f * 2 + 1] = strip.offsetX + x[f * 2 + 1]! * strip.scale;
  }

  return { frameCount: strip.frameCount, x };
}

/** Fills missing values linearly between the nearest known frames. */
function fillGaps(x: Float32Array, frameCount: number): void {
  for (const offset of [0, 1]) {
    let lastKnown = -1;
    for (let f = 0; f < frameCount; f++) {
      const i = f * 2 + offset;
      if (!Number.isFinite(x[i]!)) continue;
      if (lastKnown >= 0 && f - lastKnown > 1) {
        const from = x[lastKnown * 2 + offset]!;
        const to = x[i]!;
        for (let g = lastKnown + 1; g < f; g++) {
          const t = (g - lastKnown) / (f - lastKnown);
          x[g * 2 + offset] = from + (to - from) * t;
        }
      }
      lastKnown = f;
    }
    if (lastKnown < 0) continue;
    for (let f = 0; f < frameCount; f++) {
      const i = f * 2 + offset;
      if (!Number.isFinite(x[i]!)) {
        const source = f < lastKnown ? nextKnown(x, frameCount, offset, f) : lastKnown;
        if (source !== null) x[i] = x[source * 2 + offset]!;
      }
    }
  }
}

function nextKnown(
  x: Float32Array,
  frameCount: number,
  offset: number,
  from: number,
): number | null {
  for (let f = from; f < frameCount; f++) {
    if (Number.isFinite(x[f * 2 + offset]!)) return f;
  }
  return null;
}

/**
 * Gives every event the hand that was nearer at the moment of the strike.
 * Events that already know their hand from the bar colour are left alone.
 */
export function assignHandsByPosition(
  events: NoteEvent[],
  tracks: HandTracks,
  geometry: KeyboardGeometry,
  fps: number,
): void {
  const keyCenter = new Map<number, number>();
  for (const k of geometry.keys) keyCenter.set(k.midi, k.center);

  for (const e of events) {
    if (e.hand !== 'unknown') continue;
    const center = keyCenter.get(e.midi);
    if (center === undefined) continue;
    const frame = Math.min(tracks.frameCount - 1, Math.max(0, Math.round(e.start * fps)));
    const left = tracks.x[frame * 2]!;
    const right = tracks.x[frame * 2 + 1]!;
    const dLeft = Number.isFinite(left) ? Math.abs(center - left) : Infinity;
    const dRight = Number.isFinite(right) ? Math.abs(center - right) : Infinity;
    if (dLeft === Infinity && dRight === Infinity) continue;
    e.hand = dLeft <= dRight ? 'left' : 'right';
  }
}
