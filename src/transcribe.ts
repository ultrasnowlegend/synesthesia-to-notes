import { readSamples } from './audio/audio.js';
import {
  detectEvents,
  estimateSplitPoint,
  splitByPitch,
  type DetectionOptions,
} from './core/detection.js';
import { assignHandsByPosition, trackHands, type HandOptions } from './core/hands.js';
import type { Image } from './core/image.js';
import type { KeyboardOptions } from './core/keyboard.js';
import { estimateOctaveShift, type OctaveResult } from './core/octave.js';
import { findOnsets } from './core/onsets.js';
import { refineWithAudio, syncWithAudio, type AudioSync } from './core/sync.js';
import type { Trace } from './core/trace.js';
import {
  alignToStart,
  estimateTempo,
  quantise,
  type TempoOptions,
} from './core/tempo.js';
import { estimateKey, type KeySignature } from './core/tonality.js';
import type { HandTracks, KeyboardGeometry, Note, NoteEvent, Tempo } from './core/types.js';
import { readVideoInfo, type VideoInfo } from './video/ffmpeg.js';
import { calibrate } from './video/calibration.js';
import { buildTrace, type SamplingOptions } from './video/sampling.js';

export interface TranscribeOptions {
  keyboard?: KeyboardOptions;
  sampling?: SamplingOptions;
  detection?: DetectionOptions;
  hands?: HandOptions;
  tempo?: TempoOptions;
  calibrationSamples?: number;
  /** Skip the audio entirely; the image then works alone, at frame accuracy. */
  withoutAudio?: boolean;
  /** Keep the octave as the image read it, even when the audio disagrees. */
  octaveFromAudio?: boolean;
  /** Optional progress reporting; the CLI and the app render it their own way. */
  onStatus?: (message: string) => void;
}

export interface Transcription {
  info: VideoInfo;
  geometry: KeyboardGeometry;
  /** The resting frame the geometry came from; used to check calibration. */
  background: Image;
  trace: Trace;
  handTracks: HandTracks;
  events: NoteEvent[];
  notes: Note[];
  tempo: Tempo;
  key: KeySignature;
  splitPoint: number;
  /** Fall speed of the bar in px per frame; NaN when it could not be measured. */
  fallSpeed: number;
  /** The threshold detection finally ran at. */
  threshold: number;
  /** Agreement with the audio; the precision is also a measure of confidence. */
  sync: AudioSync;
  /** Octave correction derived from the audio. */
  octave: OctaveResult;
}

/**
 * The whole conversion of one video. The order of the steps is fixed and each
 * works only on the result of the previous one, so any of them can be swapped
 * out or run again with different settings without decoding the video afresh.
 */
export async function transcribeVideo(
  video: string,
  options: TranscribeOptions = {},
): Promise<Transcription> {
  const say = options.onStatus ?? ((): void => {});

  say('reading video metadata');
  const info = await readVideoInfo(video);

  say(`calibrating the keyboard (${info.width}x${info.height}, ${info.fps.toFixed(2)} fps)`);
  const calibration = await calibrate(
    video,
    info,
    options.keyboard ?? {},
    options.calibrationSamples ?? 40,
  );
  const geometry = calibration.geometry;
  const background = calibration.background;
  say(
    `found ${geometry.keys.length} keys, MIDI range ${geometry.keys[0]?.midi}-${geometry.keys[geometry.keys.length - 1]?.midi}`,
  );

  say('reading the video');
  const { trace, strip } = await buildTrace(video, info, geometry, options.sampling ?? {});
  say(`processed ${trace.frameCount} frames`);

  say('looking for notes');
  const detection = detectEvents(trace, geometry, options.detection ?? {});
  const events = detection.events;
  say(`found ${events.length} notes`);

  say('tracking the hands');
  const handTracks = trackHands(strip, options.hands ?? {});
  assignHandsByPosition(events, handTracks, geometry, trace.fps);

  const splitPoint = estimateSplitPoint(events);
  splitByPitch(events, splitPoint);

  let sync: AudioSync = { offset: 0, precision: 0, coverage: 0 };
  let octave: OctaveResult = { shift: 0, confidence: 0, scores: [] };
  if (!options.withoutAudio) {
    say('comparing with the audio');
    try {
      const samples = await readSamples(video);
      const strikes = findOnsets(samples);
      sync = syncWithAudio(events, strikes);
      if (sync.precision > 0.5) {
        refineWithAudio(events, strikes, sync.offset);
        events.sort((a, b) => a.start - b.start || a.midi - b.midi);
      }
      say(
        `audio: ${strikes.length} strikes, offset ${Math.round(sync.offset * 1000)} ms, ` +
          `agreement ${Math.round(sync.precision * 100)} %`,
      );

      // The layout of the keys fixes pitch only up to a multiple of an octave.
      // Where the whole keyboard is not in frame, the audio supplies the rest.
      if (options.octaveFromAudio ?? true) {
        octave = estimateOctaveShift(samples, events);
        if (octave.shift !== 0 && octave.confidence > 0.15) {
          // The shift has to reach the geometry and the trace as well, or the
          // calibration preview would label keys an octave away from the notes.
          for (const e of events) e.midi += octave.shift;
          for (const k of geometry.keys) k.midi += octave.shift;
          for (let i = 0; i < trace.midi.length; i++) trace.midi[i]! += octave.shift;
          say(`octave: shifted by ${octave.shift} semitones (confidence ${octave.confidence.toFixed(2)})`);
        } else {
          say(`octave: the image was right (confidence ${octave.confidence.toFixed(2)})`);
        }
      }
    } catch (e) {
      say(`the audio could not be processed (${(e as Error).message}); carrying on without it`);
    }
  }

  say('estimating tempo');
  const tempo = estimateTempo(events, options.tempo ?? {});
  const notes = quantise(events, tempo, options.tempo ?? {});
  alignToStart(notes);
  const key = estimateKey(notes);
  say(`tempo ${tempo.bpm} BPM (fit ${tempo.fit.toFixed(2)}), key signature ${key.fifths}`);

  return {
    info,
    geometry,
    background,
    trace,
    handTracks,
    events,
    notes,
    tempo,
    key,
    splitPoint,
    fallSpeed: detection.fallSpeed,
    threshold: detection.threshold,
    sync,
    octave,
  };
}
