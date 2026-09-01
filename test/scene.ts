import { spawn } from 'node:child_process';

import type { Color } from '../src/core/types.js';

/**
 * Renders a synthetic recording in the style this tool targets: a real keyboard
 * covered by hands with falling bars above it that carry on across the keyboard
 * and fade out. It gives us a known truth to measure the whole chain against
 * before any real footage exists.
 */

const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
const BLACK_FOLLOWS = [true, true, false, true, true, true, false] as const;

export interface SceneNote {
  midi: number;
  /** The time the bar lands on the keyboard, in seconds. */
  start: number;
  end: number;
  hand: 'left' | 'right';
}

export interface Scene {
  width: number;
  height: number;
  fps: number;
  duration: number;
  topEdge: number;
  bottomEdge: number;
  /** MIDI number of the leftmost white key. */
  firstMidi: number;
  whiteCount: number;
  /** Fall speed of the bars in pixels per second. */
  speed: number;
  /** When false both bars share a colour and tracking must name the hands. */
  coloredHands: boolean;
  notes: SceneNote[];
}

const BACKGROUND: Color = { r: 14, g: 16, b: 20 };
const WHITE: Color = { r: 242, g: 242, b: 240 };
const BLACK: Color = { r: 20, g: 22, b: 26 };
const GAP: Color = { r: 120, g: 124, b: 130 };
const HAND: Color = { r: 108, g: 112, b: 120 };
const BAR_RIGHT: Color = { r: 232, g: 161, b: 60 };
const BAR_LEFT: Color = { r: 51, g: 183, b: 158 };

export interface SceneKey {
  midi: number;
  black: boolean;
  x1: number;
  x2: number;
}

/** The key layout the scene draws from and detection is measured against. */
export function sceneKeys(s: Scene): SceneKey[] {
  const whiteWidth = s.width / s.whiteCount;
  const out: SceneKey[] = [];
  const whiteMidis: number[] = [];

  for (let i = 0; i < s.whiteCount; i++) {
    const cls = i % 7;
    const midi = s.firstMidi + SEMITONES[cls]! + 12 * Math.floor(i / 7);
    whiteMidis.push(midi);
    out.push({
      midi,
      black: false,
      x1: Math.round(i * whiteWidth),
      x2: Math.round((i + 1) * whiteWidth) - 1,
    });
  }
  for (let i = 0; i < s.whiteCount - 1; i++) {
    if (!BLACK_FOLLOWS[i % 7]) continue;
    const center = (i + 1) * whiteWidth;
    const width = whiteWidth * 0.58;
    out.push({
      midi: whiteMidis[i]! + 1,
      black: true,
      x1: Math.round(center - width / 2),
      x2: Math.round(center + width / 2) - 1,
    });
  }
  return out.sort((a, b) => a.midi - b.midi);
}

function box(
  data: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color,
  alpha = 1,
): void {
  const fromX = Math.max(0, Math.round(x1));
  const toX = Math.min(width - 1, Math.round(x2));
  const fromY = Math.max(0, Math.round(y1));
  const toY = Math.min(height - 1, Math.round(y2));
  for (let y = fromY; y <= toY; y++) {
    let i = (y * width + fromX) * 3;
    for (let x = fromX; x <= toX; x++) {
      data[i] = data[i]! + (color.r - data[i]!) * alpha;
      data[i + 1] = data[i + 1]! + (color.g - data[i + 1]!) * alpha;
      data[i + 2] = data[i + 2]! + (color.b - data[i + 2]!) * alpha;
      i += 3;
    }
  }
}

/** A hand sits over the centre of the last key it played. */
function handPosition(
  s: Scene,
  keys: readonly SceneKey[],
  hand: 'left' | 'right',
  time: number,
): number {
  const centers = new Map(keys.map((k) => [k.midi, (k.x1 + k.x2) / 2]));
  let last = hand === 'left' ? s.width * 0.25 : s.width * 0.7;
  for (const n of s.notes) {
    if (n.hand !== hand || n.start > time) continue;
    const center = centers.get(n.midi);
    if (center !== undefined) last = center;
  }
  // A little extra movement: a motionless hand would not vanish in the median.
  return last + Math.sin(time * 1.7) * 12;
}

export function renderFrame(s: Scene, time: number): Uint8Array {
  const data = new Uint8Array(s.width * s.height * 3);
  box(data, s.width, s.height, 0, 0, s.width - 1, s.height - 1, BACKGROUND);

  const keys = sceneKeys(s);
  const blackBottom = s.topEdge + (s.bottomEdge - s.topEdge) * 0.6;

  for (const k of keys) {
    if (k.black) continue;
    box(data, s.width, s.height, k.x1, s.topEdge, k.x2, s.bottomEdge, WHITE);
    box(data, s.width, s.height, k.x2 - 1, s.topEdge, k.x2, s.bottomEdge, GAP);
  }
  for (const k of keys) {
    if (!k.black) continue;
    box(data, s.width, s.height, k.x1, s.topEdge, k.x2, blackBottom, BLACK);
  }

  // Bars fall from above; the lower edge lands on the keyboard exactly at the
  // start time and then carries on across it.
  for (const n of s.notes) {
    const k = keys.find((c) => c.midi === n.midi);
    if (!k) continue;
    const bottom = s.topEdge + (time - n.start) * s.speed;
    const top = bottom - (n.end - n.start) * s.speed;
    if (bottom < 0 || top > s.topEdge) continue;
    const color = s.coloredHands && n.hand === 'left' ? BAR_LEFT : BAR_RIGHT;
    // A white key's bar takes only its visible width, without the part hidden by
    // the neighbouring black keys; that is how players draw it too.
    const left = keys.find((c) => c.black && c.x2 >= k.x1 && c.x2 <= k.x2);
    const right = keys.find((c) => c.black && c.x1 >= k.x1 && c.x1 <= k.x2);
    const fromX = k.black || !left ? k.x1 + 1 : left.x2 + 1;
    const toX = k.black || !right ? k.x2 - 1 : right.x1 - 1;
    box(data, s.width, s.height, fromX, top, toX, Math.min(bottom, s.topEdge - 1), color);

    // The bar does not stop at the keyboard — it carries on across it and fades.
    // That overlap across the static keys is the main detection signal.
    const depth = (s.bottomEdge - s.topEdge) * 0.55;
    if (bottom >= s.topEdge) {
      box(
        data,
        s.width,
        s.height,
        fromX,
        Math.max(top, s.topEdge),
        toX,
        Math.min(bottom, s.topEdge + depth),
        color,
        0.8,
      );
    }
  }

  for (const hand of ['left', 'right'] as const) {
    const center = handPosition(s, keys, hand, time);
    const handWidth = (s.width / s.whiteCount) * 3.4;
    box(
      data,
      s.width,
      s.height,
      center - handWidth / 2,
      s.topEdge + (s.bottomEdge - s.topEdge) * 0.35,
      center + handWidth / 2,
      s.bottomEdge - 4,
      HAND,
    );
  }

  return data;
}

/** Encodes the scene into an mp4 through ffmpeg. */
export function renderVideo(s: Scene, path: string): Promise<void> {
  const frameCount = Math.round(s.duration * s.fps);
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      process.env['FFMPEG_PATH'] ?? 'ffmpeg',
      [
        '-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', `${s.width}x${s.height}`, '-r', String(s.fps),
        '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
        '-pix_fmt', 'yuv420p',
        path,
      ],
      { windowsHide: true },
    );

    let errors = '';
    ffmpeg.stderr.on('data', (d: Buffer) => (errors += d.toString()));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${errors}`)),
    );

    let i = 0;
    const pump = (): void => {
      while (i < frameCount) {
        const frame = Buffer.from(renderFrame(s, i / s.fps));
        i++;
        if (!ffmpeg.stdin.write(frame)) {
          ffmpeg.stdin.once('drain', pump);
          return;
        }
      }
      ffmpeg.stdin.end();
    };
    pump();
  });
}
