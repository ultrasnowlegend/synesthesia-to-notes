import { colorDistance, hue, medianColor, saturation } from './color.js';
import { otsu } from './image.js';
import { colorAt, type Layer, type Trace } from './trace.js';
import type { Color, Hand, KeyboardGeometry, NoteEvent } from './types.js';

export interface DetectionOptions {
  /** Deviation from the resting colour, 0..1. Derived from the data if absent. */
  threshold?: number;
  /** Flashes shorter than this many frames are discarded as noise. */
  minFrames?: number;
  /** Gaps of at most this many frames are merged; they come from edge smoothing. */
  mergeGapFrames?: number;
  /**
   * How much stronger a neighbour must be before the key is dropped as bleed.
   * A lit key spills light onto neighbouring columns, but always markedly
   * weaker than the source itself.
   */
  neighbourRatio?: number;
  /**
   * Shift the times by how long the bar takes from the keys to the glow row.
   * Off by default: the shift is constant, so syncing with the audio absorbs it
   * anyway, and on a real recording the glow inside the keyboard turned out not
   * to behave like a rigid falling bar, making the measured speed unreliable.
   */
  correctLag?: boolean;
  /** Assign hands by bar hue when the video distinguishes them. */
  handsFromColor?: boolean;
}

const DEFAULTS = {
  minFrames: 2,
  mergeGapFrames: 1,
  neighbourRatio: 1.8,
  correctLag: false,
  handsFromColor: true,
} as const;

/**
 * Otsu finds the boundary between silence and any signal at all. The working
 * threshold sits well above it: below that lies a band of faint glow spilling
 * from neighbouring keys, not enough for a real note. The multiplier was chosen
 * against a recording of a real piano and is the only constant in the whole
 * detection that may need retuning for a different look of video.
 */
const THRESHOLD_FACTOR = 1.8;

/**
 * The resting colour of each column is the median over the whole video. A bar
 * covers any given place only a fraction of the time, so the median shows the
 * background even in dense passages; there is no need to hunt for a silent frame.
 */
export function restingColors(trace: Trace, layer: Layer, samples = 400): Color[] {
  const n = trace.midi.length;
  const step = Math.max(1, Math.floor(trace.frameCount / samples));
  const out: Color[] = [];
  for (let k = 0; k < n; k++) {
    const taken: Color[] = [];
    for (let f = 0; f < trace.frameCount; f += step) taken.push(colorAt(trace, layer, f, k));
    out.push(medianColor(taken));
  }
  return out;
}

/** Deviation of every column from its resting colour, frame by frame. */
export function deviations(trace: Trace, layer: Layer, resting: readonly Color[]): Float32Array {
  const n = trace.midi.length;
  const out = new Float32Array(trace.frameCount * n);
  for (let f = 0; f < trace.frameCount; f++) {
    for (let k = 0; k < n; k++) {
      out[f * n + k] = colorDistance(colorAt(trace, layer, f, k), resting[k]!);
    }
  }
  return out;
}

/**
 * The boundary between "empty" and "bar" is found by Otsu over the distribution
 * of all deviations. A hand-picked constant would not survive different looks of
 * video; the lower bound is only there so that a video where almost nothing is
 * played does not start seeing notes in codec noise.
 */
export function estimateThreshold(dev: Float32Array): number {
  const wanted = Math.min(dev.length, 200_000);
  const step = Math.max(1, Math.floor(dev.length / wanted));
  const scaled: number[] = [];
  for (let i = 0; i < dev.length; i += step) scaled.push(dev[i]! * 255);
  return Math.max(0.06, otsu(scaled) / 255);
}

interface Run {
  key: number;
  from: number;
  to: number;
}

/** Contiguous stretches where a column is covered, with gaps and flashes smoothed. */
function runs(
  lit: (f: number, k: number) => boolean,
  frameCount: number,
  keyCount: number,
  minFrames: number,
  mergeGap: number,
): Run[] {
  const out: Run[] = [];
  for (let k = 0; k < keyCount; k++) {
    let from = -1;
    let last = -1;
    for (let f = 0; f < frameCount; f++) {
      if (lit(f, k)) {
        if (from < 0) from = f;
        else if (f - last - 1 > mergeGap) {
          if (last - from + 1 >= minFrames) out.push({ key: k, from, to: last });
          from = f;
        }
        last = f;
      }
    }
    if (from >= 0 && last - from + 1 >= minFrames) out.push({ key: k, from, to: last });
  }
  return out;
}

/**
 * Fall speed of the bar in pixels per frame. The same bar passes the upper row
 * before the lower one, so it is enough to find the shift at which the two
 * signals line up best.
 *
 * Only rising edges are compared, not whole covered stretches: a long bar covers
 * a row for dozens of frames and correlating whole stretches would give a flat
 * maximum with no readable shift. Edges are sharp and the maximum is definite.
 *
 * Returns NaN when no shift wins clearly.
 */
export function measureFallSpeed(
  trace: Trace,
  upper: Layer,
  lower: Layer,
  gapPixels: number,
  threshold: number,
  restingUpper: readonly Color[],
  restingLower: readonly Color[],
  maxShift = 90,
): number {
  const n = trace.midi.length;
  if (gapPixels <= 0) return NaN;

  const onsets = (layer: Layer, resting: readonly Color[]): Uint8Array => {
    const out = new Uint8Array(trace.frameCount * n);
    const previous = new Uint8Array(n);
    for (let f = 0; f < trace.frameCount; f++) {
      for (let k = 0; k < n; k++) {
        const covered = colorDistance(colorAt(trace, layer, f, k), resting[k]!) > threshold ? 1 : 0;
        out[f * n + k] = covered === 1 && previous[k] === 0 ? 1 : 0;
        previous[k] = covered;
      }
    }
    return out;
  };

  const upperOnsets = onsets(upper, restingUpper);
  const lowerOnsets = onsets(lower, restingLower);

  let bestShift = -1;
  let bestScore = 0;
  let runnerUp = 0;
  for (let shift = 1; shift <= maxShift; shift++) {
    let agreement = 0;
    for (let f = 0; f + shift < trace.frameCount; f++) {
      const a = f * n;
      const b = (f + shift) * n;
      for (let k = 0; k < n; k++) {
        if (upperOnsets[a + k] === 1 && lowerOnsets[b + k] === 1) agreement++;
      }
    }
    if (agreement > bestScore) {
      runnerUp = bestScore;
      bestScore = agreement;
      bestShift = shift;
    } else if (agreement > runnerUp) {
      runnerUp = agreement;
    }
  }

  // Without a clear winner the result is just the loudest noise; return nothing.
  if (bestShift < 1 || bestScore < 6 || bestScore < runnerUp * 1.12) return NaN;
  return gapPixels / bestShift;
}

interface Cluster {
  cos: number;
  sin: number;
  midiSum: number;
  count: number;
}

function clusterHue(c: Cluster): number {
  const h = (Math.atan2(c.sin, c.cos) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * Splits bar colours into two hue clusters. When they come out close together
 * the video does not distinguish the hands by colour and null is returned; the
 * split then has to come from hand tracking.
 */
export function handHues(
  samples: readonly { hue: number; midi: number }[],
): { left: number; right: number } | null {
  if (samples.length < 20) return null;

  const sorted = [...samples].sort((x, y) => x.hue - y.hue);
  let centerA = sorted[Math.floor(sorted.length * 0.15)]!.hue;
  let centerB = sorted[Math.floor(sorted.length * 0.85)]!.hue;
  let a: Cluster = { cos: 0, sin: 0, midiSum: 0, count: 0 };
  let b: Cluster = { cos: 0, sin: 0, midiSum: 0, count: 0 };

  for (let iteration = 0; iteration < 12; iteration++) {
    a = { cos: 0, sin: 0, midiSum: 0, count: 0 };
    b = { cos: 0, sin: 0, midiSum: 0, count: 0 };
    for (const s of samples) {
      const rad = (s.hue * Math.PI) / 180;
      const dA = Math.abs(((s.hue - centerA + 540) % 360) - 180);
      const dB = Math.abs(((s.hue - centerB + 540) % 360) - 180);
      const target = dA <= dB ? a : b;
      target.cos += Math.cos(rad);
      target.sin += Math.sin(rad);
      target.midiSum += s.midi;
      target.count++;
    }
    if (a.count === 0 || b.count === 0) return null;
    centerA = clusterHue(a);
    centerB = clusterHue(b);
  }

  if (Math.abs(((centerA - centerB + 540) % 360) - 180) < 25) return null;
  return a.midiSum / a.count <= b.midiSum / b.count
    ? { left: centerA, right: centerB }
    : { left: centerB, right: centerA };
}

export interface DetectionResult {
  events: NoteEvent[];
  threshold: number;
  /** Fall speed in px per frame; NaN when it could not be measured. */
  fallSpeed: number;
  /** By how many seconds the times were shifted for the glow row's offset. */
  lag: number;
  handHues: { left: number; right: number } | null;
}

/**
 * Turns the colour trace into a list of notes. The main signal is the row just
 * below the top edge of the keyboard: the bar passes through it and the time it
 * covers the row is the length of the note. Two notes in a row separate by
 * themselves, because there is always a gap between bars.
 */
export function detectEvents(
  trace: Trace,
  geometry: KeyboardGeometry,
  options: DetectionOptions = {},
): DetectionResult {
  const n = trace.midi.length;
  const minFrames = options.minFrames ?? DEFAULTS.minFrames;
  const mergeGap = options.mergeGapFrames ?? DEFAULTS.mergeGapFrames;

  const restingGlow = restingColors(trace, 'glow');
  const dev = deviations(trace, 'glow', restingGlow);
  const threshold = options.threshold ?? Math.max(0.12, estimateThreshold(dev) * THRESHOLD_FACTOR);
  const neighbourRatio = options.neighbourRatio ?? DEFAULTS.neighbourRatio;

  // A lit key spills light onto the neighbouring columns; the spill is always
  // markedly weaker than the source, so comparing with the neighbours suffices.
  const lit = (f: number, k: number): boolean => {
    const v = dev[f * n + k]!;
    if (v <= threshold) return false;
    const left = k > 0 ? dev[f * n + k - 1]! : 0;
    const right = k < n - 1 ? dev[f * n + k + 1]! : 0;
    return Math.max(left, right) <= v * neighbourRatio;
  };

  // Speed is measured between two rows inside the keyboard. A row above it has
  // moving video behind it, so most of its rising edges are noise and the
  // correlation has no definite maximum.
  const restingDepth = restingColors(trace, 'depth');
  const fallSpeed = measureFallSpeed(
    trace,
    'glow',
    'depth',
    geometry.depthRow - geometry.glowRow,
    threshold,
    restingGlow,
    restingDepth,
  );

  // The glow row sits below the top edge of the keyboard, so the bar reaches it
  // only after landing on the keys; the detected time is late by that much. The
  // shift is constant and changes no lengths, only starts.
  const offset = geometry.glowRow - geometry.topEdge;
  const lag =
    (options.correctLag ?? DEFAULTS.correctLag) && Number.isFinite(fallSpeed)
      ? -offset / fallSpeed / trace.fps
      : 0;

  const found = runs(lit, trace.frameCount, n, minFrames, mergeGap);

  const described = found.map((r) => {
    const colors: Color[] = [];
    let sum = 0;
    for (let f = r.from; f <= r.to; f++) {
      colors.push(colorAt(trace, 'glow', f, r.key));
      sum += dev[f * n + r.key]!;
    }
    const length = r.to - r.from + 1;
    return {
      run: r,
      color: medianColor(colors),
      confidence: Math.min(1, sum / length / Math.max(threshold, 1e-6) / 3),
    };
  });

  let hues: { left: number; right: number } | null = null;
  if (options.handsFromColor ?? DEFAULTS.handsFromColor) {
    hues = handHues(
      described
        .filter((d) => saturation(d.color) > 0.25)
        .map((d) => ({ hue: hue(d.color), midi: trace.midi[d.run.key]! })),
    );
  }

  const events: NoteEvent[] = described.map((d) => {
    let hand: Hand = 'unknown';
    if (hues && saturation(d.color) > 0.2) {
      const h = hue(d.color);
      const dLeft = Math.abs(((h - hues.left + 540) % 360) - 180);
      const dRight = Math.abs(((h - hues.right + 540) % 360) - 180);
      hand = dLeft <= dRight ? 'left' : 'right';
    }
    return {
      midi: trace.midi[d.run.key]!,
      start: d.run.from / trace.fps + lag,
      end: (d.run.to + 1) / trace.fps + lag,
      hand,
      color: d.color,
      confidence: d.confidence,
    };
  });

  events.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { events, threshold, fallSpeed, lag, handHues: hues };
}

/** Fallback when neither colour nor position can name the hand: split by pitch. */
export function splitByPitch(events: NoteEvent[], splitPoint: number): void {
  for (const e of events) {
    if (e.hand === 'unknown') e.hand = e.midi < splitPoint ? 'left' : 'right';
  }
}

/** The split point between hands: the pitch that divides the notes most evenly near middle C. */
export function estimateSplitPoint(events: readonly NoteEvent[]): number {
  if (events.length === 0) return 60;
  const pitches = events.map((e) => e.midi);
  let best = 60;
  let bestScore = -Infinity;
  for (let candidate = 48; candidate <= 72; candidate++) {
    let below = 0;
    for (const p of pitches) if (p < candidate) below++;
    const balance = 1 - Math.abs(below / pitches.length - 0.5) * 2;
    const nearMiddleC = 1 - Math.abs(candidate - 60) / 24;
    const score = balance + nearMiddleC * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
