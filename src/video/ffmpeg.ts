import { spawn } from 'node:child_process';

/**
 * Paths to the binaries can be overridden through the environment so the
 * application works where ffmpeg is not on the PATH — typically a packaged
 * desktop build.
 */
export const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
export const FFPROBE = process.env['FFPROBE_PATH'] ?? 'ffprobe';

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

function runAndCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = '';
    let errors = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (errors += d.toString()));
    child.on('error', (e) => reject(new Error(`Could not start ${command}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code}\n${errors.slice(-2000)}`));
    });
  });
}

function fractionToNumber(text: string): number {
  const [numerator, denominator] = text.split('/');
  const n = Number(numerator);
  const d = Number(denominator ?? 1);
  return d === 0 ? 0 : n / d;
}

export async function readVideoInfo(video: string): Promise<VideoInfo> {
  const json = await runAndCapture(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    video,
  ]);
  const data = JSON.parse(json) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const stream = data.streams?.[0];
  if (!stream?.width || !stream.height) {
    throw new Error(`No video stream found in ${video}.`);
  }
  const fps =
    fractionToNumber(stream.avg_frame_rate ?? '0/1') ||
    fractionToNumber(stream.r_frame_rate ?? '25/1');
  return {
    width: stream.width,
    height: stream.height,
    fps: fps || 25,
    duration: Number(data.format?.duration ?? 0),
  };
}

/** Runs ffmpeg and hands over raw rgb24 frames of a fixed size, one at a time. */
export function readRawFrames(
  args: string[],
  bytesPerFrame: number,
  onFrame: (data: Uint8Array, index: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let index = 0;
    let errors = '';

    child.stdout.on('data', (piece: Buffer) => {
      leftover = leftover.length === 0 ? piece : Buffer.concat([leftover, piece]);
      while (leftover.length >= bytesPerFrame) {
        onFrame(new Uint8Array(leftover.buffer, leftover.byteOffset, bytesPerFrame), index++);
        leftover = leftover.subarray(bytesPerFrame);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      errors += d.toString();
      if (errors.length > 8000) errors = errors.slice(-4000);
    });
    child.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(index);
      else reject(new Error(`ffmpeg exited with code ${code}\n${errors.slice(-2000)}`));
    });
  });
}
