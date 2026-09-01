import { readRawFrames } from '../video/ffmpeg.js';

/**
 * Decodes the audio track into mono float samples. More than 22 kHz is not
 * needed — we are only looking for the moments of the strikes, not for pitch.
 */
export async function readSamples(video: string, sampleRate = 22050): Promise<Float32Array> {
  const pieces: Float32Array[] = [];
  const perChunk = 1 << 16;
  await readRawFrames(
    [
      '-v', 'error',
      '-i', video,
      '-vn',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 'f32le',
      '-',
    ],
    perChunk * 4,
    (data) => {
      pieces.push(new Float32Array(data.slice().buffer));
    },
  );

  let length = 0;
  for (const p of pieces) length += p.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const p of pieces) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
