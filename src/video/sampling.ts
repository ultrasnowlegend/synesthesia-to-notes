import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requiredRows, rowZones } from '../core/keyboard.js';
import type { KeyboardStrip } from '../core/hands.js';
import { writeColor, type Trace } from '../core/trace.js';
import type { Color, KeyboardGeometry } from '../core/types.js';
import { readRawFrames, type VideoInfo } from './ffmpeg.js';

export interface SamplingOptions {
  /** Width of the shrunken keyboard strip used for hand tracking. */
  stripWidth?: number;
  stripHeight?: number;
  /** Fraction of a key's width left out at each edge. */
  keyInset?: number;
}

const DEFAULTS = { stripWidth: 320, stripHeight: 24, keyInset: 0.18 } as const;

/**
 * A filter that cuts only the rows we need out of each frame and stacks them.
 * Thanks to it ffmpeg emits a handful of rows instead of 1080, without having to
 * run several processes or decode the video more than once.
 */
function rowGraph(rows: readonly number[], input: string, output: string): string {
  if (rows.length === 1) return `[${input}]crop=iw:1:0:${rows[0]}[${output}]`;
  const parts: string[] = [];
  const names = rows.map((_, i) => `${output}s${i}`);
  parts.push(`[${input}]split=${rows.length}${names.map((j) => `[${j}]`).join('')}`);
  const cropped = rows.map((_, i) => `${output}c${i}`);
  rows.forEach((y, i) => parts.push(`[${names[i]}]crop=iw:1:0:${y}[${cropped[i]}]`));
  parts.push(`${cropped.map((o) => `[${o}]`).join('')}vstack=inputs=${rows.length}[${output}]`);
  return parts.join(';');
}

function meanOverArea(
  data: Uint8Array,
  width: number,
  rows: readonly number[],
  x1: number,
  x2: number,
): Color {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const y of rows) {
    const start = y * width * 3;
    for (let x = x1; x <= x2; x++) {
      const i = start + x * 3;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      count++;
    }
  }
  return count === 0 ? { r: 0, g: 0, b: 0 } : { r: r / count, g: g / count, b: b / count };
}

interface GrowingBuffer {
  data: Uint8Array;
  frameCapacity: number;
}

function grow(buffer: GrowingBuffer, framesNeeded: number, bytesPerFrame: number): void {
  if (framesNeeded <= buffer.frameCapacity) return;
  const next = Math.max(framesNeeded, Math.ceil(buffer.frameCapacity * 1.6) + 60);
  const bigger = new Uint8Array(next * bytesPerFrame);
  bigger.set(buffer.data);
  buffer.data = bigger;
  buffer.frameCapacity = next;
}

export interface SamplingResult {
  trace: Trace;
  strip: KeyboardStrip;
}

/**
 * A single pass over the video. One decode produces both things needed further
 * on: the colours above every key, and a shrunken strip of the keyboard for
 * tracking the hands.
 */
export async function buildTrace(
  video: string,
  info: VideoInfo,
  geometry: KeyboardGeometry,
  options: SamplingOptions = {},
): Promise<SamplingResult> {
  const stripWidth = options.stripWidth ?? DEFAULTS.stripWidth;
  const stripHeight = options.stripHeight ?? DEFAULTS.stripHeight;
  const inset = options.keyInset ?? DEFAULTS.keyInset;

  const rows = requiredRows(geometry);
  const zones = rowZones(geometry);
  const n = geometry.keys.length;
  const bytesPerFrame = info.width * rows.length * 3;

  const ranges = geometry.keys.map((k) => {
    const width = k.ownX2 - k.ownX1 + 1;
    const cut = Math.min(Math.floor(width / 3), Math.max(1, Math.round(width * inset)));
    return { x1: k.ownX1 + cut, x2: Math.max(k.ownX1 + cut, k.ownX2 - cut) };
  });

  const bandHeight = Math.max(1, geometry.bottomEdge - geometry.topEdge + 1);
  const stripFile = join(tmpdir(), `syn2notes-strip-${randomBytes(6).toString('hex')}.raw`);

  // Converting to rgb24 must come before the crop: in yuv420p the colour planes
  // are subsampled to half height, so ffmpeg refuses a one-row crop as having
  // zero height.
  const filter = [
    `[0:v]fps=${info.fps.toFixed(6)},format=rgb24,split=2[rowsIn][stripIn]`,
    rowGraph(rows, 'rowsIn', 'rows'),
    `[stripIn]crop=iw:${bandHeight}:0:${geometry.topEdge},scale=${stripWidth}:${stripHeight}:flags=area[strip]`,
  ].join(';');

  const estimate = Math.max(1, Math.ceil(info.duration * info.fps) + 30);
  const glow: GrowingBuffer = { data: new Uint8Array(estimate * n * 3), frameCapacity: estimate };
  const depth: GrowingBuffer = { data: new Uint8Array(estimate * n * 3), frameCapacity: estimate };
  const impact: GrowingBuffer = { data: new Uint8Array(estimate * n * 3), frameCapacity: estimate };

  const frameCount = await readRawFrames(
    [
      '-v', 'error',
      '-y',
      '-i', video,
      '-filter_complex', filter,
      '-map', '[rows]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
      '-map', '[strip]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', stripFile,
    ],
    bytesPerFrame,
    (data, index) => {
      grow(glow, index + 1, n * 3);
      grow(depth, index + 1, n * 3);
      grow(impact, index + 1, n * 3);
      for (let k = 0; k < n; k++) {
        const { x1, x2 } = ranges[k]!;
        writeColor(glow.data, index, k, n, meanOverArea(data, info.width, zones.glow, x1, x2));
        writeColor(depth.data, index, k, n, meanOverArea(data, info.width, zones.depth, x1, x2));
        writeColor(impact.data, index, k, n, meanOverArea(data, info.width, zones.impact, x1, x2));
      }
    },
  );

  const trim = (buffer: GrowingBuffer): Uint8Array => buffer.data.subarray(0, frameCount * n * 3);
  const trace: Trace = {
    fps: info.fps,
    frameCount,
    midi: geometry.keys.map((k) => k.midi),
    glow: trim(glow),
    depth: trim(depth),
    impact: trim(impact),
  };

  const rawStrip = await readFile(stripFile);
  await rm(stripFile, { force: true });
  const stripFrames = Math.floor(rawStrip.length / (stripWidth * stripHeight * 3));
  const strip: KeyboardStrip = {
    width: stripWidth,
    height: stripHeight,
    frameCount: Math.min(stripFrames, frameCount),
    data: new Uint8Array(rawStrip.buffer, rawStrip.byteOffset, rawStrip.length),
    offsetX: 0,
    scale: info.width / stripWidth,
  };

  return { trace, strip };
}
