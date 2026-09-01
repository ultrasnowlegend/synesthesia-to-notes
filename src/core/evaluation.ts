/**
 * Measuring a transcription against a reference. It uses the usual criterion
 * from music transcription: a note counts as found when its pitch matches
 * exactly and its start falls within a given tolerance. Note endings are
 * deliberately not judged — in the video the length is how long the bar is lit,
 * whereas in MIDI it is when the key is released, and those are two different
 * things.
 */

export interface TimedPitch {
  midi: number;
  start: number;
}

export interface Score {
  /** Fraction of found notes that have a counterpart in the reference. */
  precision: number;
  /** Fraction of reference notes that were found. */
  recall: number;
  f1: number;
  matched: number;
  found: number;
  reference: number;
  /** Mean deviation of the start among matched notes, in seconds. */
  timingError: number;
}

/**
 * Assigns every reference note the nearest not-yet-consumed found note of the
 * same pitch. The assignment is greedy rather than optimal, but at tolerances
 * below a tenth of a second the two differ by only a handful of notes.
 */
export function compareNotes(
  found: readonly TimedPitch[],
  reference: readonly TimedPitch[],
  tolerance = 0.05,
): Score {
  const byPitch = new Map<number, { start: number; used: boolean }[]>();
  for (const n of found) {
    const list = byPitch.get(n.midi);
    const entry = { start: n.start, used: false };
    if (list) list.push(entry);
    else byPitch.set(n.midi, [entry]);
  }
  for (const list of byPitch.values()) list.sort((a, b) => a.start - b.start);

  let matched = 0;
  let errorSum = 0;
  for (const r of [...reference].sort((a, b) => a.start - b.start)) {
    const list = byPitch.get(r.midi);
    if (!list) continue;
    let best = -1;
    let smallest = tolerance;
    for (let i = 0; i < list.length; i++) {
      const candidate = list[i]!;
      if (candidate.used) continue;
      const diff = Math.abs(candidate.start - r.start);
      if (diff <= smallest) {
        smallest = diff;
        best = i;
      }
    }
    if (best >= 0) {
      list[best]!.used = true;
      matched++;
      errorSum += smallest;
    }
  }

  const precision = found.length ? matched / found.length : 0;
  const recall = reference.length ? matched / reference.length : 0;
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    matched,
    found: found.length,
    reference: reference.length,
    timingError: matched ? errorSum / matched : 0,
  };
}

/**
 * Finds the offset at which the transcription fits the reference best. The video
 * starts at a different moment than the piece — a tutorial usually opens with a
 * count-in — so without this step even a correctly read note would not line up.
 */
export function findReferenceOffset(
  found: readonly TimedPitch[],
  reference: readonly TimedPitch[],
  maxOffset = 20,
  step = 0.02,
  tolerance = 0.05,
): { offset: number; score: Score } {
  let best = { offset: 0, score: compareNotes(found, reference, tolerance) };
  for (let offset = -maxOffset; offset <= maxOffset + 1e-9; offset += step) {
    const shifted = found.map((n) => ({ midi: n.midi, start: n.start + offset }));
    const score = compareNotes(shifted, reference, tolerance);
    if (score.f1 > best.score.f1) best = { offset, score };
  }
  return best;
}
