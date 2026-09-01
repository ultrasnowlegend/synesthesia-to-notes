import type { Note, Tempo } from './types.js';

const TICKS_PER_BEAT = 480;

function varlen(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

function u32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function chunk(events: readonly number[][]): number[] {
  const body = events.flat();
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

interface TimedEvent {
  tick: number;
  /** Lower goes first at equal times; note-off must precede note-on. */
  order: number;
  bytes: number[];
}

function withDeltas(events: TimedEvent[]): number[][] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  return events.map((e) => {
    const delta = e.tick - last;
    last = e.tick;
    return [...varlen(delta), ...e.bytes];
  });
}

export interface MidiOptions {
  /** Title written into the metadata. */
  title?: string;
}

/**
 * Writes the notes as a standard MIDI file of type 1: the first track carries
 * tempo and time signature, the other two correspond to the hands. Writing it
 * ourselves keeps the core free of dependencies — the format is simple enough.
 */
export function writeMidi(
  notes: readonly Note[],
  tempo: Tempo,
  fifths: number,
  options: MidiOptions = {},
): Uint8Array {
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(3), ...u16(TICKS_PER_BEAT)];

  const microsecondsPerBeat = Math.round(60_000_000 / tempo.bpm);
  const control: number[][] = [];
  if (options.title) {
    const name = [...new TextEncoder().encode(options.title)];
    control.push([0x00, 0xff, 0x03, ...varlen(name.length), ...name]);
  }
  control.push([
    0x00, 0xff, 0x51, 0x03,
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff,
  ]);
  control.push([
    0x00, 0xff, 0x58, 0x04,
    tempo.numerator,
    Math.round(Math.log2(tempo.denominator)),
    24,
    8,
  ]);
  control.push([0x00, 0xff, 0x59, 0x02, fifths & 0xff, 0x00]);

  const tracks = [chunk(control)];
  for (const [channel, hand] of [
    [0, 'right'],
    [1, 'left'],
  ] as const) {
    const selected = notes.filter((n) => (hand === 'right' ? n.hand !== 'left' : n.hand === 'left'));
    const events: TimedEvent[] = [];
    events.push({ tick: 0, order: 0, bytes: [0xc0 | channel, 0] });
    for (const n of selected) {
      const start = Math.round(n.beat * TICKS_PER_BEAT);
      const end = Math.max(start + 1, Math.round((n.beat + n.length) * TICKS_PER_BEAT));
      events.push({ tick: start, order: 2, bytes: [0x90 | channel, n.midi & 0x7f, n.velocity & 0x7f] });
      events.push({ tick: end, order: 1, bytes: [0x80 | channel, n.midi & 0x7f, 0x40] });
    }
    tracks.push(chunk(withDeltas(events)));
  }

  return Uint8Array.from([...header, ...tracks.flat()]);
}
