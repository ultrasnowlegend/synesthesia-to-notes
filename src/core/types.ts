/** Which hand a note belongs to; decides which staff it is written on. */
export type Hand = 'left' | 'right' | 'unknown';

/** One key found in the image, together with the pitch assigned to it. */
export interface Key {
  midi: number;
  black: boolean;
  /** Left edge in pixels, inclusive. */
  x1: number;
  /** Right edge in pixels, inclusive. */
  x2: number;
  center: number;
  /**
   * The span this key shares with no other. A black key sits inside the width
   * of both neighbouring white keys, so a white key's bar would also colour the
   * black key's column; only this narrower strip is sampled.
   */
  ownX1: number;
  ownX2: number;
}

/**
 * Keyboard geometry read off a single frame. Coordinates are pixels of the
 * source video and hold for one recording only: the camera is static during it
 * but moves between takes, so geometry is never reused.
 */
export interface KeyboardGeometry {
  imageWidth: number;
  imageHeight: number;
  /** Y of the top edge of the keyboard. */
  topEdge: number;
  /** Y of the bottom edge of the keyboard. */
  bottomEdge: number;
  /** Y of the row where white keys are sampled, below the black ones. */
  whiteRow: number;
  /** Y of the row where black keys are sampled. */
  blackRow: number;
  /**
   * Y of the row just below the top edge of the keyboard. The main signal: the
   * bar carries on across the keyboard and fades out, but here it has static
   * keys behind it instead of moving video, so it stands out unambiguously.
   */
  glowRow: number;
  /**
   * Y of a row deeper into the keyboard. Together with the glow row it yields
   * the fall speed: both sit over static keys, so their signal is clean,
   * whereas rows above the keyboard have moving video behind them.
   */
  depthRow: number;
  /** Y of a row just above the keyboard, above the impact glow. */
  impactRow: number;
  keys: Key[];
}

/** An RGB colour, components 0..255. */
export interface Color {
  r: number;
  g: number;
  b: number;
}

/** Both hand positions over time; x is in source pixels, NaN when not found. */
export interface HandTracks {
  frameCount: number;
  /** x[frame * 2] is the left hand, x[frame * 2 + 1] the right. */
  x: Float32Array;
}

/** A raw event before quantisation: a note held from one time to another. */
export interface NoteEvent {
  midi: number;
  start: number;
  end: number;
  hand: Hand;
  /** Average bar colour; when the video colours the hands, it identifies them. */
  color: Color;
  /** Detection confidence, 0..1. */
  confidence: number;
}

/** A note after quantisation, ready to be written into notation. */
export interface Note {
  midi: number;
  /** Start in beats from the beginning of the piece. */
  beat: number;
  /** Length in beats. */
  length: number;
  hand: Hand;
  velocity: number;
}

/** The result of tempo estimation. */
export interface Tempo {
  bpm: number;
  /** Time of the first beat, in seconds. */
  offset: number;
  numerator: number;
  denominator: number;
  /** How well the grid fits the onsets, 0..1. */
  fit: number;
}
