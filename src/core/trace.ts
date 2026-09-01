import type { Color, KeyboardGeometry } from './types.js';

/** Which stored layer of the trace to read. */
export type Layer = 'glow' | 'depth' | 'impact';

/**
 * A time trace of colours. It is produced by a single pass over the video and
 * is the only intermediate result written to disk: for 88 keys and ten minutes
 * at 30 fps it comes to about 8 MB, so tuning thresholds never has to decode
 * the video again. The format is deliberately a bare Uint8Array, not an array
 * of objects.
 */
export interface Trace {
  fps: number;
  frameCount: number;
  /** MIDI numbers of the keys, in the order their columns are stored. */
  midi: number[];
  /** Glow on the key; the main signal. Index (frame * n + key) * 3. */
  glow: Uint8Array;
  /** A row deeper in the keyboard; its lag behind the glow gives fall speed. */
  depth: Uint8Array;
  /** A row above the keyboard; the bar reaches it before landing on the keys. */
  impact: Uint8Array;
}

export function keyCount(t: Trace): number {
  return t.midi.length;
}

export function colorAt(t: Trace, layer: Layer, frame: number, key: number): Color {
  const array = t[layer];
  const i = (frame * t.midi.length + key) * 3;
  return { r: array[i]!, g: array[i + 1]!, b: array[i + 2]! };
}

export function emptyTrace(g: KeyboardGeometry, fps: number, frameCount: number): Trace {
  const n = g.keys.length;
  const size = frameCount * n * 3;
  return {
    fps,
    frameCount,
    midi: g.keys.map((k) => k.midi),
    glow: new Uint8Array(size),
    depth: new Uint8Array(size),
    impact: new Uint8Array(size),
  };
}

export function writeColor(
  target: Uint8Array,
  frame: number,
  key: number,
  columns: number,
  c: Color,
): void {
  const i = (frame * columns + key) * 3;
  target[i] = Math.round(c.r);
  target[i + 1] = Math.round(c.g);
  target[i + 2] = Math.round(c.b);
}
