import type { Image } from './image.js';
import type { KeyboardGeometry, NoteEvent } from './types.js';

/**
 * Pictures showing what the tool found in the image. Calibration is the one part
 * of the chain that cannot be checked against the audio, so it has to be
 * checkable by eye.
 */

export interface Canvas {
  width: number;
  height: number;
  data: Uint8Array;
}

function dot(c: Canvas, x: number, y: number, r: number, g: number, b: number, alpha = 1): void {
  if (x < 0 || x >= c.width || y < 0 || y >= c.height) return;
  const i = (y * c.width + x) * 3;
  c.data[i] = c.data[i]! + (r - c.data[i]!) * alpha;
  c.data[i + 1] = c.data[i + 1]! + (g - c.data[i + 1]!) * alpha;
  c.data[i + 2] = c.data[i + 2]! + (b - c.data[i + 2]!) * alpha;
}

function box(
  c: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  alpha = 1,
): void {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) dot(c, x, y, r, g, b, alpha);
}

/**
 * The resting frame with each key's own strip marked and a tick at every C.
 * When the ticks sit on the right keys, the whole calibration is right.
 */
export function drawCalibration(g: KeyboardGeometry, background: Image): Canvas {
  const fromY = Math.max(0, g.impactRow - 24);
  const toY = Math.min(background.height - 1, g.bottomEdge + 8);
  const height = toY - fromY + 1;
  const c: Canvas = {
    width: background.width,
    height,
    data: new Uint8Array(background.width * height * 3),
  };
  for (let y = 0; y < height; y++) {
    const source = (fromY + y) * background.width * 3;
    c.data.set(
      background.data.subarray(source, source + background.width * 3),
      y * background.width * 3,
    );
  }

  const glow = g.glowRow - fromY;
  for (const k of g.keys) {
    const [r, gg, b] = k.black ? [90, 200, 255] : [255, 150, 60];
    box(c, k.ownX1, glow - 2, k.ownX2, glow + 2, r, gg, b, 0.85);
  }
  for (const k of g.keys) {
    if (k.midi % 12 !== 0) continue;
    const x = Math.round(k.center);
    box(c, x - 1, g.bottomEdge - fromY - 26, x, g.bottomEdge - fromY, 255, 70, 220, 0.9);
  }
  return c;
}

/** The found notes as a piano roll across the whole recording. */
export function drawPianoRoll(
  events: readonly NoteEvent[],
  duration: number,
  width = 1200,
): Canvas {
  const fromMidi = 21;
  const toMidi = 108;
  const keyHeight = 3;
  const height = (toMidi - fromMidi + 1) * keyHeight;
  const c: Canvas = { width, height, data: new Uint8Array(width * height * 3) };
  box(c, 0, 0, width - 1, height - 1, 16, 18, 24);

  for (let m = fromMidi; m <= toMidi; m++) {
    if (m % 12 !== 0) continue;
    const y = (toMidi - m) * keyHeight;
    box(c, 0, y, width - 1, y, 40, 44, 54);
  }

  for (const e of events) {
    const x1 = Math.round((e.start / duration) * (width - 1));
    const x2 = Math.max(x1, Math.round((e.end / duration) * (width - 1)));
    const y = (toMidi - Math.max(fromMidi, Math.min(toMidi, e.midi))) * keyHeight;
    const [r, g, b] = e.hand === 'left' ? [70, 200, 175] : [240, 170, 70];
    box(c, x1, y, x2, y + keyHeight - 2, r, g, b);
  }
  return c;
}
