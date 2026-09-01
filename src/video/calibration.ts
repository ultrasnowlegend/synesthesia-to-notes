import { findKeyboard, type KeyboardOptions } from '../core/keyboard.js';
import { medianFrame, type Image } from '../core/image.js';
import type { KeyboardGeometry } from '../core/types.js';
import { readRawFrames, type VideoInfo } from './ffmpeg.js';

/**
 * Reads a single frame at the given time. Seeking before -i is fast, because
 * ffmpeg jumps to the nearest key frame instead of decoding from the start.
 */
async function frameAt(video: string, time: number, info: VideoInfo): Promise<Image | null> {
  let result: Uint8Array | null = null;
  await readRawFrames(
    [
      '-v', 'error',
      '-ss', time.toFixed(3),
      '-i', video,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    info.width * info.height * 3,
    (data) => {
      if (!result) result = Uint8Array.from(data);
    },
  );
  return result ? { width: info.width, height: info.height, data: result } : null;
}

export interface CalibrationResult {
  geometry: KeyboardGeometry;
  /** The resting frame the geometry came from; useful for a preview. */
  background: Image;
  usedTimes: number[];
}

/**
 * Reads the keyboard geometry from the median of a few dozen frames spread over
 * the whole video. Hands are somewhere different in every frame and the keyboard
 * is not, so the median shows a bare keyboard even for a real piano.
 *
 * Calibration holds for one recording: the camera is static during it but moves
 * between takes, so the result is never reused.
 */
export async function calibrate(
  video: string,
  info: VideoInfo,
  options: KeyboardOptions = {},
  sampleCount = 40,
): Promise<CalibrationResult> {
  const duration = info.duration > 0 ? info.duration : 1;
  const times: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    times.push((duration * (i + 0.5)) / sampleCount);
  }

  const frames: Image[] = [];
  const usedTimes: number[] = [];
  for (const time of times) {
    const frame = await frameAt(video, time, info);
    if (frame) {
      frames.push(frame);
      usedTimes.push(time);
    }
  }
  if (frames.length === 0) throw new Error(`No frame could be read from ${video}.`);

  const background = medianFrame(frames);
  return { geometry: findKeyboard(background, options), background, usedTimes };
}
