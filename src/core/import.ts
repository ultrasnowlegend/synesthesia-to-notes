import { estimateSplitPoint, splitByPitch } from './detection.js';
import { readMidi } from './midiRead.js';
import { writeMusicXml } from './notation.js';
import { alignToStart, quantise } from './tempo.js';
import { estimateKey } from './tonality.js';
import type { Hand, NoteEvent, Tempo } from './types.js';

/**
 * Bringing a MIDI file into the score view, so anything recorded on a digital
 * piano — or exported from elsewhere — can be practised from notation too.
 *
 * A MIDI file already lies on a grid; only the finest subdivision it uses has
 * to be found, and the hands, which a file rarely names. When it has two
 * tracks with notes, the higher one is the right hand; otherwise the pitch
 * decides, as it does for a video.
 */
export function midiToMusicXml(data: Uint8Array, title: string): string {
  const file = readMidi(data);
  if (file.notes.length === 0) throw new Error('The MIDI file holds no notes.');

  const byTrack = new Map<number, number[]>();
  for (const n of file.notes) {
    const list = byTrack.get(n.track) ?? [];
    list.push(n.midi);
    byTrack.set(n.track, list);
  }
  const tracks = [...byTrack.entries()].map(([track, pitches]) => ({
    track,
    mean: pitches.reduce((a, b) => a + b, 0) / pitches.length,
  }));
  const handOf = new Map<number, Hand>();
  if (tracks.length === 2) {
    tracks.sort((a, b) => b.mean - a.mean);
    handOf.set(tracks[0]!.track, 'right');
    handOf.set(tracks[1]!.track, 'left');
  }

  const events: NoteEvent[] = file.notes.map((n) => ({
    midi: n.midi,
    start: n.start,
    end: n.end,
    hand: handOf.get(n.track) ?? 'unknown',
    color: { r: 0, g: 0, b: 0 },
    confidence: n.velocity / 127,
  }));
  const splitPoint = estimateSplitPoint(events);
  splitByPitch(events, splitPoint);

  const bpm = Math.round(file.bpm * 100) / 100;
  const tempo: Tempo = { bpm, offset: 0, numerator: 4, denominator: 4, fit: 1 };
  const division = finestDivision(events, bpm);
  const notes = quantise(events, tempo, { division });
  alignToStart(notes);
  const key = estimateKey(notes);
  return writeMusicXml(notes, tempo, key.fifths, { title, splitPoint, legato: 0.25 });
}

/** The coarsest subdivision of the beat that still holds every onset. */
function finestDivision(events: readonly NoteEvent[], bpm: number): number {
  for (const division of [1, 2, 4, 3, 6, 8]) {
    let off = 0;
    for (const e of events) {
      const beat = (e.start * bpm) / 60;
      off += Math.abs(beat * division - Math.round(beat * division)) / division;
    }
    if (off / events.length < 0.01) return division;
  }
  return 4;
}
