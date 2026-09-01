import type { DetectionOptions } from '../../src/core/detection.js';
import type { KeyboardOptions } from '../../src/core/keyboard.js';
import type { AudioSync } from '../../src/core/sync.js';
import type { TempoOptions } from '../../src/core/tempo.js';
import type { Tempo } from '../../src/core/types.js';

/**
 * A reply from the main process. Not a discriminated union: `data` stays
 * optional even when `ok` holds, so on the window side always use `?? fallback`.
 */
export interface Reply<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Everything that can change without reading the video again. */
export interface GridOptions extends TempoOptions {
  /** The longest gap in beats filled by a lengthened note instead of a rest. */
  legato?: number;
}

/** Everything the window needs to remember about a transcription. */
export interface Summary {
  video: string;
  duration: number;
  fps: number;
  frames: number;
  keys: number;
  range: [number, number];
  events: number;
  notes: number;
  tempo: Tempo;
  fifths: number;
  keyName: string;
  threshold: number;
  sync: AudioSync;
  octaveShift: number;
  topEdge: number;
  bottomEdge: number;
  firstMidi: number;
  leftHandNotes: number;
  /** The resting frame with the keys marked; a data URL. */
  calibrationPreview: string;
  /** The found notes as a piano roll; a data URL. */
  rollPreview: string;
  pages: number;
}

export interface TranscribeInput {
  keyboard?: KeyboardOptions;
  detection?: DetectionOptions;
}

export interface AppBridge {
  pickVideo: () => Promise<Reply<string | null>>;
  transcribe: (
    path: string,
    options: TranscribeInput & GridOptions,
  ) => Promise<Reply<Summary>>;
  requantise: (options: GridOptions) => Promise<Reply<Summary>>;
  page: (number: number) => Promise<Reply<string>>;
  save: (kind: 'midi' | 'musicxml' | 'pdf') => Promise<Reply<string | null>>;
  revealInFolder: (path: string) => Promise<Reply<void>>;
  /** Path of a dropped file; newer Electron no longer exposes File.path. */
  filePath: (file: File) => string;
  onStatus: (listener: (message: string) => void) => () => void;
}
