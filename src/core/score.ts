import type { ScoreNote, ScoreStep } from './follow.js';

/**
 * Turning an engraved score into the chain of steps the follower walks along.
 *
 * Verovio knows when every drawn note begins (its timemap) and on which page
 * it lies; what it does not hand out directly is the staff of a note and which
 * notes merely continue a tie. Both are read from the MEI it produces — a
 * plain linear scan, since a staff element never nests in another.
 */

/** One entry of Verovio's timemap; only the fields used here. */
export interface TimemapEntry {
  tstamp: number;
  qstamp: number;
  on?: string[];
  off?: string[];
  measureOn?: string;
  tempo?: number;
}

export interface MeiFacts {
  /** Staff number of every note id. */
  staff: Map<string, number>;
  /** Notes that only continue a tie: drawn, but not struck again. */
  tieEnds: Set<string>;
  /** Where each tie leads: start note to the note it is tied to. */
  ties: Map<string, string>;
  /** Notes inside grace groups or marked as grace notes. */
  grace: Set<string>;
}

const ID = /xml:id="([^"]+)"/;

export function readMeiFacts(mei: string): MeiFacts {
  const staff = new Map<string, number>();
  const tieEnds = new Set<string>();
  const ties = new Map<string, string>();
  const grace = new Set<string>();
  let current = 1;
  const tag = /<(\/?)(staff|note|tie|graceGrp)\b([^>]*)>/g;
  let inGrace = 0;
  for (let m = tag.exec(mei); m; m = tag.exec(mei)) {
    const closing = m[1] === '/';
    const name = m[2]!;
    const attributes = m[3] ?? '';
    const selfClosing = attributes.endsWith('/');
    if (name === 'staff' && !closing) {
      const n = /\bn="(\d+)"/.exec(attributes);
      if (n) current = Number(n[1]);
    } else if (name === 'graceGrp') {
      if (closing) inGrace = Math.max(0, inGrace - 1);
      else if (!selfClosing) inGrace++;
    } else if (name === 'note' && !closing) {
      const id = ID.exec(attributes)?.[1];
      if (!id) continue;
      staff.set(id, current);
      if (inGrace > 0 || /\bgrace="/.test(attributes)) grace.add(id);
      // A tie can also be encoded on the note itself: "m" (middle) or "t"
      // (terminal) means it continues one.
      const tie = /\btie="([^"]+)"/.exec(attributes)?.[1];
      if (tie && /[mt]/.test(tie) && !/i/.test(tie)) tieEnds.add(id);
    } else if (name === 'tie' && !closing) {
      const end = /\bendid="#?([^"]+)"/.exec(attributes)?.[1];
      const start = /\bstartid="#?([^"]+)"/.exec(attributes)?.[1];
      if (end) tieEnds.add(end);
      if (start && end) ties.set(start, end);
    }
  }
  return { staff, tieEnds, ties, grace };
}

export interface StepLookup {
  /** MIDI pitch of a note id, or null when it has none (an unpitched note). */
  pitch: (id: string) => number | null;
  /** The system (from 0) a note id is drawn on. */
  system: (id: string) => number;
  facts: MeiFacts;
}

/**
 * Groups struck notes by their onset. Tie continuations are left out — they
 * are held, not played — and so are notes without a pitch. A note id met a
 * second time (an expanded repeat) is skipped, so every drawn note belongs to
 * exactly one step and its colour always means one thing.
 */
export function buildSteps(timemap: readonly TimemapEntry[], lookup: StepLookup): ScoreStep[] {
  // When every drawn note begins and ends, for the length a note sounds.
  const onAt = new Map<string, number>();
  const offAt = new Map<string, number>();
  for (const entry of timemap) {
    for (const id of entry.on ?? []) if (!onAt.has(id)) onAt.set(id, entry.tstamp);
    for (const id of entry.off ?? []) offAt.set(id, entry.tstamp);
  }
  const sounding = (id: string): number => {
    let end = offAt.get(id) ?? (onAt.get(id) ?? 0) + 500;
    // A tie carries the sound on to the end of the note it leads to.
    for (let next = lookup.facts.ties.get(id), guard = 0; next && guard < 64; next = lookup.facts.ties.get(next), guard++) {
      end = Math.max(end, offAt.get(next) ?? end);
    }
    return Math.max(30, end - (onAt.get(id) ?? end));
  };

  const seen = new Set<string>();
  const steps: ScoreStep[] = [];
  let measure = -1;
  for (const entry of timemap) {
    if (entry.measureOn) measure++;
    if (!entry.on || entry.on.length === 0) continue;
    const notes: ScoreNote[] = [];
    let system = Infinity;
    for (const id of entry.on) {
      // Grace notes are ornaments: drawn, played, but too quick to wait for.
      if (seen.has(id) || lookup.facts.tieEnds.has(id) || lookup.facts.grace.has(id)) continue;
      const midi = lookup.pitch(id);
      if (midi === null || !Number.isFinite(midi) || midi <= 0) continue;
      seen.add(id);
      notes.push({ id, midi, staff: lookup.facts.staff.get(id) ?? 1, duration: sounding(id) });
      system = Math.min(system, lookup.system(id));
    }
    if (notes.length === 0) continue;
    notes.sort((a, b) => a.midi - b.midi);
    steps.push({
      beat: entry.qstamp,
      time: entry.tstamp,
      system: Number.isFinite(system) ? system : 0,
      measure: Math.max(0, measure),
      notes,
    });
  }
  return steps;
}
