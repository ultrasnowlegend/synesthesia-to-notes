/**
 * Reading a standard MIDI file. The transcription itself does not need it — it
 * is here so the result can be measured against a reference whenever the video
 * has an original MIDI beside it. Without that, the only check available is
 * agreement with the audio, which says only *when* something was played, not what.
 */

export interface MidiNote {
  midi: number;
  /** Seconds from the start of the file. */
  start: number;
  end: number;
  velocity: number;
  track: number;
  channel: number;
}

export interface MidiFile {
  notes: MidiNote[];
  /** The first tempo found, in BPM. */
  bpm: number;
  tracks: number;
}

class Reader {
  private position = 0;

  constructor(private readonly data: Uint8Array) {}

  get atEnd(): boolean {
    return this.position >= this.data.length;
  }

  get at(): number {
    return this.position;
  }

  byte(): number {
    const b = this.data[this.position];
    if (b === undefined) throw new Error('The MIDI file ends in the middle of an event.');
    this.position++;
    return b;
  }

  peek(): number {
    return this.data[this.position] ?? 0;
  }

  number(length: number): number {
    let v = 0;
    for (let i = 0; i < length; i++) v = (v << 8) | this.byte();
    return v >>> 0;
  }

  /** A length spread over a variable number of bytes; the top bit means "continues". */
  varlen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.byte();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return v;
  }

  skip(length: number): void {
    this.position += length;
  }

  tag(): string {
    return String.fromCharCode(this.byte(), this.byte(), this.byte(), this.byte());
  }
}

interface RawEvent {
  tick: number;
  track: number;
  kind: 'on' | 'off' | 'tempo';
  midi: number;
  channel: number;
  velocity: number;
  /** Microseconds per beat for a tempo change. */
  tempo: number;
}

function readTrack(r: Reader, trackNumber: number, length: number): RawEvent[] {
  const end = r.at + length;
  const out: RawEvent[] = [];
  let tick = 0;
  let runningStatus = 0;

  while (r.at < end && !r.atEnd) {
    tick += r.varlen();
    let status = r.peek();
    if (status & 0x80) r.byte();
    else status = runningStatus; // running status: a repeated command is omitted
    if (status & 0x80 && status < 0xf0) runningStatus = status;

    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xff) {
      const kind = r.byte();
      const len = r.varlen();
      if (kind === 0x51 && len === 3) {
        const tempo = (r.byte() << 16) | (r.byte() << 8) | r.byte();
        out.push({ tick, track: trackNumber, kind: 'tempo', midi: 0, channel: 0, velocity: 0, tempo });
      } else {
        r.skip(len);
      }
    } else if (status === 0xf0 || status === 0xf7) {
      r.skip(r.varlen());
    } else if (command === 0x90 || command === 0x80) {
      const note = r.byte();
      const velocity = r.byte();
      // A note-on with zero velocity is a note-off by the standard.
      const kind = command === 0x90 && velocity > 0 ? 'on' : 'off';
      out.push({ tick, track: trackNumber, kind, midi: note, channel, velocity, tempo: 0 });
    } else if (command === 0xa0 || command === 0xb0 || command === 0xe0) {
      r.skip(2);
    } else if (command === 0xc0 || command === 0xd0) {
      r.skip(1);
    } else {
      throw new Error(`Unknown MIDI status byte 0x${status.toString(16)}.`);
    }
  }

  return out;
}

/** Converts ticks to seconds using the map of tempo changes. */
function timeMap(events: readonly RawEvent[], ticksPerBeat: number): (tick: number) => number {
  const changes = events
    .filter((e) => e.kind === 'tempo')
    .sort((a, b) => a.tick - b.tick)
    .map((e) => ({ tick: e.tick, tempo: e.tempo }));
  if (changes.length === 0 || changes[0]!.tick > 0) changes.unshift({ tick: 0, tempo: 500_000 });

  const anchors = [{ tick: 0, time: 0, tempo: changes[0]!.tempo }];
  for (let i = 1; i < changes.length; i++) {
    const previous = anchors[anchors.length - 1]!;
    const time =
      previous.time + ((changes[i]!.tick - previous.tick) * previous.tempo) / ticksPerBeat / 1e6;
    anchors.push({ tick: changes[i]!.tick, time, tempo: changes[i]!.tempo });
  }

  return (tick) => {
    let a = anchors[0]!;
    for (const candidate of anchors) {
      if (candidate.tick <= tick) a = candidate;
      else break;
    }
    return a.time + ((tick - a.tick) * a.tempo) / ticksPerBeat / 1e6;
  };
}

export function readMidi(data: Uint8Array): MidiFile {
  const r = new Reader(data);
  if (r.tag() !== 'MThd') throw new Error('The file does not begin with an MThd header.');
  const headerLength = r.number(4);
  r.number(2); // format
  const trackCount = r.number(2);
  const division = r.number(2);
  r.skip(headerLength - 6);
  if (division & 0x8000) throw new Error('SMPTE timing is not supported yet.');

  const all: RawEvent[] = [];
  for (let t = 0; t < trackCount && !r.atEnd; t++) {
    if (r.tag() !== 'MTrk') break;
    const length = r.number(4);
    all.push(...readTrack(r, t, length));
  }

  const toTime = timeMap(all, division);
  const open = new Map<string, RawEvent>();
  const notes: MidiNote[] = [];

  for (const e of all.sort((a, b) => a.tick - b.tick || (a.kind === 'off' ? -1 : 1))) {
    if (e.kind === 'tempo') continue;
    const key = `${e.track}:${e.channel}:${e.midi}`;
    if (e.kind === 'on') {
      const earlier = open.get(key);
      if (earlier) notes.push(close(earlier, e.tick, toTime));
      open.set(key, e);
    } else {
      const earlier = open.get(key);
      if (earlier) {
        notes.push(close(earlier, e.tick, toTime));
        open.delete(key);
      }
    }
  }
  for (const [, e] of open) notes.push(close(e, e.tick + division, toTime));

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const firstTempo = all.find((e) => e.kind === 'tempo')?.tempo ?? 500_000;
  return { notes, bpm: 60_000_000 / firstTempo, tracks: trackCount };
}

function close(e: RawEvent, endTick: number, toTime: (t: number) => number): MidiNote {
  return {
    midi: e.midi,
    start: toTime(e.tick),
    end: toTime(endTick),
    velocity: e.velocity,
    track: e.track,
    channel: e.channel,
  };
}
