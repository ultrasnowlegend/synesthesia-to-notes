import type { Note, NoteEvent, Tempo } from './types.js';

export interface TempoOptions {
  /** A fixed BPM; estimated from the onsets when absent. */
  bpm?: number;
  /** A fixed time for the first beat, in seconds. */
  offset?: number;
  numerator?: number;
  denominator?: number;
  /** Smallest subdivision of a beat: 4 = sixteenths, 2 = eighths, 6 = eighth triplets. */
  division?: number;
  /** Range of tempi to search. */
  minBpm?: number;
  maxBpm?: number;
}

/** Starts falling together are one chord and count as a single onset. */
export function onsetTimes(events: readonly NoteEvent[], tolerance = 0.05): number[] {
  const starts = events.map((e) => e.start).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of starts) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > tolerance) out.push(t);
  }
  return out;
}

/**
 * Strength of a grid with the given period: the sum of unit vectors of every
 * onset's phase. When the onsets fit the grid the phases add up; when they do
 * not, they cancel out. The angle of the result also gives the best offset of
 * the grid directly.
 */
function combFilter(onsets: readonly number[], period: number): { strength: number; phase: number } {
  let cos = 0;
  let sin = 0;
  for (const t of onsets) {
    const angle = (2 * Math.PI * t) / period;
    cos += Math.cos(angle);
    sin += Math.sin(angle);
  }
  const n = Math.max(1, onsets.length);
  const strength = Math.hypot(cos, sin) / n;
  let phase = Math.atan2(sin, cos) / (2 * Math.PI);
  if (phase < 0) phase += 1;
  return { strength, phase };
}

/**
 * A weight favouring the usual range of tempi. Without it the comb filter almost
 * always wins at twice or half the true tempo, because the onsets fit there too.
 */
function tempoPrior(bpm: number): number {
  const log = Math.log2(bpm / 110);
  return Math.exp(-(log * log) / (2 * 0.55 * 0.55));
}

export function estimateTempo(events: readonly NoteEvent[], options: TempoOptions = {}): Tempo {
  const numerator = options.numerator ?? 4;
  const denominator = options.denominator ?? 4;
  const onsets = onsetTimes(events);

  if (options.bpm !== undefined) {
    const period = 60 / options.bpm;
    const f = combFilter(onsets, period);
    return {
      bpm: options.bpm,
      offset: options.offset ?? (onsets[0] ?? 0) - Math.floor((onsets[0] ?? 0) / period) * period,
      numerator,
      denominator,
      fit: f.strength,
    };
  }

  if (onsets.length < 4) {
    return { bpm: 100, offset: onsets[0] ?? 0, numerator, denominator, fit: 0 };
  }

  const minBpm = options.minBpm ?? 45;
  const maxBpm = options.maxBpm ?? 200;
  const search = (sample: readonly number[]): { bpm: number; phase: number; strength: number } => {
    let best = { bpm: 100, phase: 0, strength: 0, score: -1 };
    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
      const f = combFilter(sample, 60 / bpm);
      const score = f.strength * tempoPrior(bpm);
      if (score > best.score) best = { bpm, phase: f.phase, strength: f.strength, score };
    }
    return best;
  };

  /*
   * A longer recording cannot be measured with one comb across its whole length:
   * even a tenth of a percent of tempo error accumulates into whole beats over
   * three minutes and the phase drifts away, so even a steadily played piece
   * comes out as noise. Tempo is therefore searched in overlapping windows and
   * the median is taken.
   */
  const span = onsets[onsets.length - 1]! - onsets[0]!;
  const window = 12;
  let best: { bpm: number; phase: number; strength: number };
  if (span > window * 2) {
    const estimates: { bpm: number; strength: number }[] = [];
    for (let start = onsets[0]!; start + window <= onsets[onsets.length - 1]!; start += window / 2) {
      const sample = onsets.filter((t) => t >= start && t < start + window);
      if (sample.length < 8) continue;
      const v = search(sample);
      estimates.push({ bpm: v.bpm, strength: v.strength });
    }
    if (estimates.length > 0) {
      const sorted = [...estimates].sort((a, b) => a.bpm - b.bpm);
      const middle = sorted[sorted.length >> 1]!;
      const strengths = estimates.map((e) => e.strength).sort((a, b) => a - b);
      // The phase is recomputed once over all onsets, so the grid starts where
      // the piece does even if its average fit is weaker.
      const f = combFilter(onsets, 60 / middle.bpm);
      best = { bpm: middle.bpm, phase: f.phase, strength: strengths[strengths.length >> 1]! };
    } else {
      best = search(onsets);
    }
  } else {
    best = search(onsets);
  }

  const period = 60 / best.bpm;
  // The phase says where the grid lies; convert it to the first beat before the
  // first onset.
  let offset = best.phase * period;
  const first = onsets[0]!;
  while (offset > first + period / 2) offset -= period;
  while (offset < first - period / 2) offset += period;

  return {
    bpm: options.bpm ?? Math.round(best.bpm * 4) / 4,
    offset: options.offset ?? offset,
    numerator,
    denominator,
    fit: best.strength,
  };
}

/** Converts seconds to beats according to the estimated tempo. */
export function toBeats(time: number, tempo: Tempo): number {
  return ((time - tempo.offset) * tempo.bpm) / 60;
}

/**
 * Snaps the events onto a rhythmic grid. Length is rounded separately from the
 * start so the error does not accumulate; a note never shrinks below one step
 * of the grid.
 */
export function quantise(
  events: readonly NoteEvent[],
  tempo: Tempo,
  options: TempoOptions = {},
): Note[] {
  const division = options.division ?? 4;
  const step = 1 / division;
  const snap = (beat: number): number => Math.round(beat / step) * step;

  const notes: Note[] = [];
  for (const e of events) {
    const start = snap(toBeats(e.start, tempo));
    let end = snap(toBeats(e.end, tempo));
    if (end <= start) end = start + step;
    notes.push({
      midi: e.midi,
      beat: start,
      length: end - start,
      hand: e.hand,
      velocity: Math.max(40, Math.min(110, Math.round(50 + e.confidence * 50))),
    });
  }

  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return removeOverlaps(notes);
}

/** Two notes of the same pitch must not overlap; the shorter one gives way. */
function removeOverlaps(notes: Note[]): Note[] {
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const list = byPitch.get(n.midi);
    if (list) list.push(n);
    else byPitch.set(n.midi, [n]);
  }
  const out: Note[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < list.length; i++) {
      const n = list[i]!;
      const next = list[i + 1];
      if (next && n.beat + n.length > next.beat) n.length = next.beat - n.beat;
      if (n.length > 0) out.push(n);
    }
  }
  out.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return out;
}

/** Shifts the piece so the first note starts on the first beat of the first bar. */
export function alignToStart(notes: Note[]): void {
  const first = notes[0];
  if (!first || first.beat === 0) return;
  const shift = first.beat;
  for (const n of notes) n.beat -= shift;
}
