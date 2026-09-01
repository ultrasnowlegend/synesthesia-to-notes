import { compareOnsets } from './onsets.js';
import type { NoteEvent } from './types.js';

export interface AudioSync {
  /** How many seconds the image times must move to line up with the audio. */
  offset: number;
  /** Fraction of image strikes that have an audio strike after the shift. */
  precision: number;
  /** Fraction of audio strikes that have an image strike. */
  coverage: number;
}

/** Start times where notes sounding together count as a single strike. */
export function imageStrikes(events: readonly NoteEvent[], tolerance = 0.05): number[] {
  const starts = events.map((e) => e.start).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of starts) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > tolerance) out.push(t);
  }
  return out;
}

/**
 * Finds the constant offset between image and audio. Screen recordings rarely
 * have the two perfectly aligned and the difference can exceed a tenth of a
 * second, so we look for the offset at which the most image strikes meet an
 * audio one.
 *
 * A by-product is a measure of confidence in the detection: image and audio are
 * independent sources, so a high agreement after the shift means we are reading
 * the image correctly.
 */
export function syncWithAudio(
  events: readonly NoteEvent[],
  audioStrikes: readonly number[],
  maxOffset = 0.5,
  tolerance = 0.05,
): AudioSync {
  const strikes = imageStrikes(events);
  if (strikes.length < 10 || audioStrikes.length < 10) {
    return { offset: 0, precision: 0, coverage: 0 };
  }

  let best: AudioSync = { offset: 0, precision: 0, coverage: 0 };
  for (let offset = -maxOffset; offset <= maxOffset + 1e-9; offset += 0.01) {
    const r = compareOnsets(
      strikes.map((t) => t + offset),
      audioStrikes,
      tolerance,
    );
    if (r.precision > best.precision) {
      best = { offset, precision: r.precision, coverage: r.coverage };
    }
  }
  return best;
}

/**
 * Snaps note starts to the nearest audio strike. At 30 frames per second the
 * image has a step of 33 ms, whereas a strike can be located in the audio to
 * about 5 ms; the audio never decides the pitch, only the time.
 */
export function refineWithAudio(
  events: NoteEvent[],
  audioStrikes: readonly number[],
  offset: number,
  tolerance = 0.04,
): number {
  if (audioStrikes.length === 0) return 0;
  const sorted = [...audioStrikes].sort((a, b) => a - b);

  const nearest = (time: number): number | null => {
    let low = 0;
    let high = sorted.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]! < time) low = middle + 1;
      else high = middle;
    }
    let best = sorted[low]!;
    if (low > 0 && Math.abs(sorted[low - 1]! - time) < Math.abs(best - time)) best = sorted[low - 1]!;
    return Math.abs(best - time) <= tolerance ? best : null;
  };

  let refined = 0;
  for (const e of events) {
    const length = e.end - e.start;
    const shifted = e.start + offset;
    const target = nearest(shifted);
    e.start = target ?? shifted;
    e.end = e.start + length;
    if (target !== null) refined++;
  }
  return refined;
}
