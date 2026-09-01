import { spellPitch } from './tonality.js';
import type { Note, Tempo } from './types.js';

/** Divisions per quarter note. 24 covers sixteenths (6) and eighth triplets (8). */
export const DIVISIONS_PER_BEAT = 24;

export interface NotationOptions {
  title?: string;
  composer?: string;
  /** MIDI number below which notes without a known hand fall to the bass staff. */
  splitPoint?: number;
  /**
   * The longest gap in beats that a lengthened note fills instead of a rest.
   * Zero keeps the rests.
   */
  legato?: number;
  /**
   * How far past the split point a note may reach before it moves to the other
   * staff. Without this, low notes of the right hand end up on five ledger lines.
   */
  staffTolerance?: number;
}

interface NoteValue {
  divisions: number;
  type: string;
  dots: number;
  triplet: boolean;
}

/** Binary note values including dotted ones, longest first. */
const VALUES: readonly (readonly [number, string, number])[] = [
  [192, 'breve', 0],
  [144, 'whole', 1],
  [96, 'whole', 0],
  [72, 'half', 1],
  [48, 'half', 0],
  [36, 'quarter', 1],
  [24, 'quarter', 0],
  [18, 'eighth', 1],
  [12, 'eighth', 0],
  [9, '16th', 1],
  [6, '16th', 0],
  [3, '32nd', 0],
];

function exactValue(divisions: number): NoteValue | null {
  for (const [d, type, dots] of VALUES) {
    if (d === divisions) return { divisions, type, dots, triplet: false };
  }
  // A triplet takes two thirds of its written value, so look for length * 3/2.
  if ((divisions * 3) % 2 === 0) {
    const written = (divisions * 3) / 2;
    for (const [d, type, dots] of VALUES) {
      if (d === written) return { divisions, type, dots, triplet: true };
    }
  }
  return null;
}

/** Breaks any length into a chain of writable values joined by ties. */
export function splitLength(divisions: number): NoteValue[] {
  const exact = exactValue(divisions);
  if (exact) return [exact];

  const out: NoteValue[] = [];
  let remaining = divisions;
  while (remaining >= 3 && out.length < 8) {
    const found = VALUES.find(([d]) => d <= remaining);
    if (!found) break;
    out.push({ divisions: found[0], type: found[1], dots: found[2], triplet: false });
    remaining -= found[0];
  }
  if (out.length === 0) out.push({ divisions: 3, type: '32nd', dots: 0, triplet: false });
  return out;
}

interface TickNote {
  midi: number;
  start: number;
  length: number;
}

interface Item {
  start: number;
  length: number;
  /** An empty array means a rest. */
  notes: TickNote[];
}

/**
 * Turns the notes of one staff into a continuous run of chords and rests with no
 * overlaps. Several voices within one staff are deliberately not attempted: for
 * reading back an improvisation a single-voice setting with chords is clearer
 * than automatically separated voices.
 *
 * Short gaps between notes are filled by lengthening the previous note. The
 * measured length ends where the bar goes dark, so a literal transcription would
 * put a sixteenth rest between every two notes and the result would be unreadable.
 */
function staffItems(notes: readonly TickNote[], end: number, legato: number): Item[] {
  const byStart = new Map<number, TickNote[]>();
  for (const n of notes) {
    const list = byStart.get(n.start);
    if (list) list.push(n);
    else byStart.set(n.start, [n]);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);

  const out: Item[] = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    if (start > cursor) out.push({ start: cursor, length: start - cursor, notes: [] });
    const group = byStart.get(start)!;
    const next = starts[i + 1] ?? end;
    const measured = Math.min(...group.map((n) => n.length));
    const toNext = next - start;
    const length = Math.max(1, Math.min(toNext - measured <= legato ? toNext : measured, toNext));
    out.push({ start, length, notes: group });
    cursor = start + length;
  }
  if (cursor < end) out.push({ start: cursor, length: end - cursor, notes: [] });
  return out;
}

interface Fragment extends Item {
  tiesForward: boolean;
  tiesBack: boolean;
}

/** Splits items at bar lines and marks the ties. */
function splitIntoBars(items: readonly Item[], barLength: number): Fragment[][] {
  const bars: Fragment[][] = [];
  const intoBar = (f: Fragment): void => {
    const index = Math.floor(f.start / barLength);
    while (bars.length <= index) bars.push([]);
    bars[index]!.push(f);
  };

  for (const item of items) {
    let start = item.start;
    let remaining = item.length;
    let isFirst = true;
    while (remaining > 0) {
      const barEnd = (Math.floor(start / barLength) + 1) * barLength;
      const length = Math.min(remaining, barEnd - start);
      const isLast = length === remaining;
      intoBar({
        start,
        length,
        notes: item.notes,
        tiesForward: item.notes.length > 0 && !isLast,
        tiesBack: item.notes.length > 0 && !isFirst,
      });
      start += length;
      remaining -= length;
      isFirst = false;
    }
  }
  return bars;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeNote(
  f: Fragment,
  value: NoteValue,
  valueIndex: number,
  valueCount: number,
  staff: number,
  fifths: number,
): string {
  const lines: string[] = [];
  const tieBack = f.tiesBack || valueIndex > 0;
  const tieForward = f.tiesForward || valueIndex < valueCount - 1;

  if (f.notes.length === 0) {
    lines.push('      <note>');
    lines.push('        <rest/>');
    lines.push(`        <duration>${value.divisions}</duration>`);
    lines.push(`        <voice>${staff}</voice>`);
    lines.push(`        <type>${value.type}</type>`);
    for (let i = 0; i < value.dots; i++) lines.push('        <dot/>');
    lines.push(`        <staff>${staff}</staff>`);
    lines.push('      </note>');
    return lines.join('\n');
  }

  const sorted = [...f.notes].sort((a, b) => a.midi - b.midi);
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    const p = spellPitch(n.midi, fifths);
    lines.push('      <note>');
    if (i > 0) lines.push('        <chord/>');
    lines.push('        <pitch>');
    lines.push(`          <step>${p.step}</step>`);
    if (p.alter !== 0) lines.push(`          <alter>${p.alter}</alter>`);
    lines.push(`          <octave>${p.octave}</octave>`);
    lines.push('        </pitch>');
    lines.push(`        <duration>${value.divisions}</duration>`);
    if (tieBack) lines.push('        <tie type="stop"/>');
    if (tieForward) lines.push('        <tie type="start"/>');
    lines.push(`        <voice>${staff}</voice>`);
    lines.push(`        <type>${value.type}</type>`);
    for (let d = 0; d < value.dots; d++) lines.push('        <dot/>');
    if (value.triplet) {
      lines.push('        <time-modification>');
      lines.push('          <actual-notes>3</actual-notes>');
      lines.push('          <normal-notes>2</normal-notes>');
      lines.push('        </time-modification>');
    }
    lines.push(`        <staff>${staff}</staff>`);
    if (tieBack || tieForward) {
      lines.push('        <notations>');
      if (tieBack) lines.push('          <tied type="stop"/>');
      if (tieForward) lines.push('          <tied type="start"/>');
      lines.push('        </notations>');
    }
    lines.push('      </note>');
  }
  return lines.join('\n');
}

function writeFragments(fragments: readonly Fragment[], staff: number, fifths: number): string {
  const out: string[] = [];
  for (const f of fragments) {
    const values = splitLength(f.length);
    for (let i = 0; i < values.length; i++) {
      out.push(writeNote(f, values[i]!, i, values.length, staff, fifths));
    }
  }
  return out.join('\n');
}

/** Produces MusicXML for a piano with two staves. */
export function writeMusicXml(
  notes: readonly Note[],
  tempo: Tempo,
  fifths: number,
  options: NotationOptions = {},
): string {
  const splitPoint = options.splitPoint ?? 60;
  const legato = Math.round((options.legato ?? 1) * DIVISIONS_PER_BEAT);
  const tolerance = options.staffTolerance ?? 12;
  const toTicks = (n: Note): TickNote => ({
    midi: n.midi,
    start: Math.round(n.beat * DIVISIONS_PER_BEAT),
    length: Math.max(1, Math.round(n.length * DIVISIONS_PER_BEAT)),
  });

  // The hand decides the staff until a note strays too far. A low note of the
  // right hand is engraved in the bass clef anyway — that is what any engraver
  // would do.
  const staffOf = (n: Note): 'right' | 'left' => {
    if (n.midi < splitPoint - tolerance) return 'left';
    if (n.midi > splitPoint + tolerance) return 'right';
    if (n.hand === 'unknown') return n.midi >= splitPoint ? 'right' : 'left';
    return n.hand;
  };
  const right = notes.filter((n) => staffOf(n) === 'right').map(toTicks);
  const left = notes.filter((n) => staffOf(n) === 'left').map(toTicks);

  const barLength = Math.round((tempo.numerator * 4 * DIVISIONS_PER_BEAT) / tempo.denominator);
  const lastTick = Math.max(
    barLength,
    ...right.map((n) => n.start + n.length),
    ...left.map((n) => n.start + n.length),
  );
  const end = Math.ceil(lastTick / barLength) * barLength;

  const rightBars = splitIntoBars(staffItems(right, end, legato), barLength);
  const leftBars = splitIntoBars(staffItems(left, end, legato), barLength);
  const barCount = Math.max(rightBars.length, leftBars.length, 1);

  const emptyBar = (i: number): Fragment[] => [
    { start: i * barLength, length: barLength, notes: [], tiesForward: false, tiesBack: false },
  ];

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  parts.push('<score-partwise version="4.0">');
  parts.push('  <work>');
  parts.push(`    <work-title>${escapeXml(options.title ?? 'Transcribed improvisation')}</work-title>`);
  parts.push('  </work>');
  parts.push('  <identification>');
  parts.push(`    <creator type="composer">${escapeXml(options.composer ?? '')}</creator>`);
  parts.push('    <encoding>');
  parts.push('      <software>synesthesia-to-notes</software>');
  parts.push('    </encoding>');
  parts.push('  </identification>');
  parts.push('  <part-list>');
  parts.push('    <score-part id="P1">');
  parts.push('      <part-name>Piano</part-name>');
  parts.push('    </score-part>');
  parts.push('  </part-list>');
  parts.push('  <part id="P1">');

  for (let i = 0; i < barCount; i++) {
    parts.push(`    <measure number="${i + 1}">`);
    if (i === 0) {
      parts.push('      <attributes>');
      parts.push(`        <divisions>${DIVISIONS_PER_BEAT}</divisions>`);
      parts.push('        <key>');
      parts.push(`          <fifths>${fifths}</fifths>`);
      parts.push('        </key>');
      parts.push('        <time>');
      parts.push(`          <beats>${tempo.numerator}</beats>`);
      parts.push(`          <beat-type>${tempo.denominator}</beat-type>`);
      parts.push('        </time>');
      parts.push('        <staves>2</staves>');
      parts.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      parts.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      parts.push('      </attributes>');
      parts.push('      <direction placement="above">');
      parts.push('        <direction-type>');
      parts.push('          <metronome>');
      parts.push('            <beat-unit>quarter</beat-unit>');
      parts.push(`            <per-minute>${Math.round(tempo.bpm)}</per-minute>`);
      parts.push('          </metronome>');
      parts.push('        </direction-type>');
      parts.push(`        <sound tempo="${Math.round(tempo.bpm)}"/>`);
      parts.push('      </direction>');
    }
    parts.push(writeFragments(rightBars[i] ?? emptyBar(i), 1, fifths));
    parts.push(`      <backup><duration>${barLength}</duration></backup>`);
    parts.push(writeFragments(leftBars[i] ?? emptyBar(i), 2, fifths));
    parts.push('    </measure>');
  }

  parts.push('  </part>');
  parts.push('</score-partwise>');
  return parts.join('\n');
}
