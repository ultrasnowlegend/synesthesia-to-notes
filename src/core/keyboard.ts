import { luma } from './color.js';
import { median, otsu, row, spans, type Image, type Span } from './image.js';
import type { Key, KeyboardGeometry } from './types.js';

export interface KeyboardOptions {
  /** Manual override of the keyboard band when detection fails. */
  topEdge?: number;
  bottomEdge?: number;
  /** Manual override of the MIDI number of the leftmost white key. */
  firstMidi?: number;
  /** Distance of the impact row above the keyboard, as a fraction of height. */
  impactOffset?: number;
}

/** Semitone of each white pitch class within an octave: C D E F G A B. */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
/** Is a white key of this class followed by a black one? Not after E and B. */
const BLACK_FOLLOWS = [true, true, false, true, true, true, false] as const;

/**
 * Common keyboard sizes. Deriving the octave from the centre of the range is a
 * tie between C1 and C2 for 61 keys, so standard layouts are pinned down.
 */
const KNOWN_LAYOUTS: Record<string, number> = {
  '52:5': 21, // 88 keys, A0
  '44:2': 28, // 76 keys, E1
  '36:0': 36, // 61 keys, C2
  '29:0': 36, // 49 keys, C2
  '22:0': 48, // 37 keys, C3
  '15:0': 48, // 25 keys, C3
};

interface KeyboardBand {
  topEdge: number;
  bottomEdge: number;
  whiteRow: number;
  blackRow: number;
  impactRow: number;
}

/** MIDI number of the i-th white key from the left. */
function whiteMidi(firstMidi: number, shift: number, i: number): number {
  const cls = (shift + i) % 7;
  const octave = Math.floor((shift + i) / 7);
  return firstMidi - SEMITONES[shift]! + SEMITONES[cls]! + 12 * octave;
}

/**
 * Finds the horizontal band the keyboard occupies. It assumes the bodies of the
 * white keys are the brightest continuous area in the lower part of the image
 * and that what lies above and below the keyboard is markedly darker.
 *
 * The light/dark boundary is not a constant but Otsu's threshold over the whole
 * frame: under warm stage lighting white keys turn amber and end up far darker
 * than any fixed limit would expect.
 */
function findBand(img: Image, options: KeyboardOptions): KeyboardBand {
  const { width, height } = img;
  const lightFraction = new Array<number>(height).fill(0);
  const step = Math.max(1, Math.floor(width / 400));

  const lumaSample: number[] = [];
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 3;
      lumaSample.push(luma({ r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! }));
    }
  }
  const lightThreshold = Math.min(170, Math.max(45, otsu(lumaSample)));

  for (let y = 0; y < height; y++) {
    let light = 0;
    let count = 0;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 3;
      if (luma({ r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! }) > lightThreshold) {
        light++;
      }
      count++;
    }
    lightFraction[y] = light / count;
  }

  const fromRow = Math.floor(height * 0.35);
  let maxLight = 0;
  for (let y = fromRow; y < height; y++) maxLight = Math.max(maxLight, lightFraction[y]!);
  const threshold = Math.max(0.2, maxLight * 0.3);

  let topEdge: number;
  let bottomEdge: number;

  if (options.topEdge !== undefined && options.bottomEdge !== undefined) {
    topEdge = options.topEdge;
    bottomEdge = options.bottomEdge;
  } else {
    if (maxLight < 0.3) {
      throw new Error('Could not locate the keyboard. Set topEdge and bottomEdge by hand.');
    }

    // The longest run of light rows, rather than growing outwards from the
    // brightest one: just above the keyboard there is often a bright impact
    // glow, brighter than the keys themselves, and growing from it would stop
    // immediately below it at the widest part of the black keys.
    topEdge = 0;
    bottomEdge = 0;
    let runStart = -1;
    for (let y = fromRow; y <= height; y++) {
      const isLight = y < height && lightFraction[y]! > threshold;
      if (isLight && runStart < 0) runStart = y;
      if (!isLight && runStart >= 0) {
        if (y - runStart > bottomEdge - topEdge) {
          topEdge = runStart;
          bottomEdge = y - 1;
        }
        runStart = -1;
      }
    }
  }

  const bandHeight = bottomEdge - topEdge;
  if (bandHeight < 8) throw new Error(`The keyboard band is too thin (${bandHeight} px).`);

  // White keys are sampled in the lower third of the band, where no black key
  // reaches any more.
  let whiteRow = bottomEdge - Math.round(bandHeight * 0.12);
  let brightest = -1;
  for (let y = topEdge + Math.round(bandHeight * 0.7); y < bottomEdge; y++) {
    if (lightFraction[y]! > brightest) {
      brightest = lightFraction[y]!;
      whiteRow = y;
    }
  }

  // Black keys always occupy the upper part of the keyboard, so this row is a
  // fixed fraction of the height. Hunting for the darkest row would slide lower,
  // where the hands are: they usually vanish in the median, but after a long
  // stretch played in one place a residue would glue the black keys together.
  const blackRow = topEdge + Math.round(bandHeight * 0.18);

  // A bright impact glow often sits above the keyboard and is lit all the time;
  // the row used to see bars must be above it, or it would be permanently
  // washed out. Skip every light row and a little of the calm band above them.
  let calm = 0;
  let y = topEdge - 1;
  while (y > 0 && calm < 5) {
    calm = lightFraction[y]! > threshold ? 0 : calm + 1;
    y--;
  }
  const calmBottom = y + calm;
  const impactRow = Math.max(
    0,
    calmBottom - Math.max(2, Math.round(bandHeight * (options.impactOffset ?? 0.04))),
  );

  return { topEdge, bottomEdge, whiteRow, blackRow, impactRow };
}

/** Drops spans disproportionately narrow or wide against the median. */
function reasonableSpans(all: Span[], lowRatio: number, highRatio: number): Span[] {
  if (all.length === 0) return [];
  const m = median(all.map((u) => u.width));
  return all.filter((u) => u.width >= m * lowRatio && u.width <= m * highRatio);
}

/**
 * White keys are evenly spaced on a keyboard, so instead of the raw spans from
 * the image we fit a line through their centres and generate the keys from it.
 *
 * Without that, a single shadow or hand residue in the median splits one key or
 * drops it, every key after it shifts by one, the black-key pattern stops
 * matching and half the black keys are discarded as invalid. It also recovers
 * keys clipped by the edge of the frame, which the width filter would reject.
 */
function whiteKeyGrid(found: readonly Span[], width: number): Span[] {
  const centers = found.map((u) => u.center).sort((a, b) => a - b);
  if (centers.length < 8) return [...found];

  const diffs: number[] = [];
  for (let i = 1; i < centers.length; i++) diffs.push(centers[i]! - centers[i - 1]!);
  const roughPitch = median(diffs);
  const adjacent = diffs.filter((d) => d > roughPitch * 0.7 && d < roughPitch * 1.3);
  const pitch = adjacent.length >= 4 ? median(adjacent) : roughPitch;
  if (!(pitch > 1)) return [...found];

  // Least squares over (index, centre); indices come from the rounded ratio, so
  // a missing key shifts nobody.
  const first = centers[0]!;
  const indices = centers.map((c) => Math.round((c - first) / pitch));
  const n = centers.length;
  const sumI = indices.reduce((s, i) => s + i, 0);
  const sumC = centers.reduce((s, c) => s + c, 0);
  const sumII = indices.reduce((s, i) => s + i * i, 0);
  const sumIC = indices.reduce((s, i, k) => s + i * centers[k]!, 0);
  const denominator = n * sumII - sumI * sumI;
  if (denominator === 0) return [...found];
  const slope = (n * sumIC - sumI * sumC) / denominator;
  const intercept = (sumC - slope * sumI) / n;

  const out: Span[] = [];
  const fromIndex = Math.ceil((0 - slope / 2 - intercept) / slope);
  const toIndex = Math.floor((width - 1 + slope / 2 - intercept) / slope);
  for (let i = fromIndex; i <= toIndex; i++) {
    const center = intercept + slope * i;
    const x1 = Math.max(0, Math.round(center - slope / 2));
    const x2 = Math.min(width - 1, Math.round(center + slope / 2) - 1);
    if (x2 - x1 < slope * 0.25) continue;
    out.push({ x1, x2, width: x2 - x1 + 1, center });
  }
  return out;
}

/**
 * Black keys form a repeating 2-3 pattern that uniquely fixes which white key
 * is C. Returns the pitch class of the leftmost white key (0 = C, 6 = B).
 */
function findShift(hasBlack: readonly boolean[]): number {
  let best = 0;
  let bestScore = -1;
  for (let shift = 0; shift < 7; shift++) {
    let score = 0;
    for (let i = 0; i < hasBlack.length; i++) {
      if (hasBlack[i] === BLACK_FOLLOWS[(shift + i) % 7]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = shift;
    }
  }
  return best;
}

/** MIDI number of the leftmost white key. */
function findFirstMidi(whiteCount: number, shift: number): number {
  const known = KNOWN_LAYOUTS[`${whiteCount}:${shift}`];
  if (known !== undefined) return known;

  // Fallback: choose the octave so the centre of the keyboard lands nearest
  // middle C. This is the one place calibration can miss, and where the audio
  // has to settle the octave afterwards.
  let best = 12 * 4 + SEMITONES[shift]!;
  let bestDistance = Infinity;
  for (let octave = 0; octave <= 8; octave++) {
    const first = 12 * octave + SEMITONES[shift]!;
    const last = whiteMidi(first, shift, whiteCount - 1);
    const distance = Math.abs((first + last) / 2 - 60);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = first;
    }
  }
  return best;
}

/** Index of the white key lying to the left of the given coordinate. */
function whiteLeftOf(whites: readonly Span[], x: number): number {
  let index = -1;
  for (let i = 0; i < whites.length; i++) {
    if (whites[i]!.center < x) index = i;
    else break;
  }
  return index;
}

/**
 * Gives every key the strip it shares with no other. A black key sits inside
 * the width of both neighbouring white keys, so a white key's bar covers the
 * black key's column too; sampling the full width would turn every note on a
 * white key into a phantom note on the black key beside it.
 */
function assignOwnSpans(keys: Key[]): void {
  const blacks = keys.filter((k) => k.black);
  for (const k of keys) {
    if (k.black) {
      k.ownX1 = k.x1;
      k.ownX2 = k.x2;
      continue;
    }
    let segments: [number, number][] = [[k.x1, k.x2]];
    for (const b of blacks) {
      const next: [number, number][] = [];
      for (const [a, z] of segments) {
        if (b.x2 < a || b.x1 > z) {
          next.push([a, z]);
          continue;
        }
        if (b.x1 > a) next.push([a, b.x1 - 1]);
        if (b.x2 < z) next.push([b.x2 + 1, z]);
      }
      segments = next;
    }
    if (segments.length === 0) {
      k.ownX1 = k.x1;
      k.ownX2 = k.x2;
      continue;
    }
    const widest = segments.reduce((n, s) => (s[1] - s[0] > n[1] - n[0] ? s : n));
    k.ownX1 = widest[0];
    k.ownX2 = widest[1];
  }
}

/**
 * Reads the keyboard geometry off a resting frame, ideally the median of the
 * video. The result is the only thing the later steps need to know about the
 * image.
 */
export function findKeyboard(img: Image, options: KeyboardOptions = {}): KeyboardGeometry {
  const band = findBand(img, options);

  const whiteLuma = row(img, band.whiteRow).map(luma);
  const whiteThreshold = otsu(whiteLuma);
  const rawWhites = reasonableSpans(
    spans(img.width, (x) => whiteLuma[x]! > whiteThreshold),
    0.45,
    1.8,
  );
  if (rawWhites.length < 7) {
    throw new Error(`Only ${rawWhites.length} white keys found; the keyboard cannot be read.`);
  }
  const whites = whiteKeyGrid(rawWhites, img.width);

  const blackLuma = row(img, band.blackRow).map(luma);
  const blackThreshold = otsu(blackLuma);
  const whiteWidth = median(whites.map((u) => u.width));
  const blacks = spans(img.width, (x) => blackLuma[x]! < blackThreshold).filter(
    (u) => u.width > whiteWidth * 0.3 && u.width < whiteWidth * 1.2,
  );

  const hasBlack = new Array<boolean>(whites.length - 1).fill(false);
  for (const b of blacks) {
    const index = whiteLeftOf(whites, b.center);
    if (index >= 0 && index < hasBlack.length) hasBlack[index] = true;
  }

  const shift = findShift(hasBlack);
  const firstMidi = options.firstMidi ?? findFirstMidi(whites.length, shift);

  const keys: Key[] = [];
  const whiteMidis: number[] = [];
  for (let i = 0; i < whites.length; i++) {
    const midi = whiteMidi(firstMidi, shift, i);
    whiteMidis.push(midi);
    const u = whites[i]!;
    keys.push({
      midi,
      black: false,
      x1: u.x1,
      x2: u.x2,
      center: u.center,
      ownX1: u.x1,
      ownX2: u.x2,
    });
  }

  for (const b of blacks) {
    const index = whiteLeftOf(whites, b.center);
    if (index < 0 || index >= whites.length - 1) continue;
    // Only accept a black key where the keyboard pattern expects one; otherwise
    // the thin divider between E and F would invent a key that does not exist.
    if (!BLACK_FOLLOWS[(shift + index) % 7]) continue;
    keys.push({
      midi: whiteMidis[index]! + 1,
      black: true,
      x1: b.x1,
      x2: b.x2,
      center: b.center,
      ownX1: b.x1,
      ownX2: b.x2,
    });
  }

  keys.sort((a, b) => a.midi - b.midi);
  assignOwnSpans(keys);

  const bandHeight = band.bottomEdge - band.topEdge;
  return {
    imageWidth: img.width,
    imageHeight: img.height,
    topEdge: band.topEdge,
    bottomEdge: band.bottomEdge,
    whiteRow: band.whiteRow,
    blackRow: band.blackRow,
    glowRow: Math.min(img.height - 1, band.topEdge + Math.max(4, Math.round(bandHeight * 0.06))),
    depthRow: Math.min(img.height - 1, band.topEdge + Math.max(14, Math.round(bandHeight * 0.3))),
    impactRow: band.impactRow,
    keys,
  };
}

/**
 * The rows read from every frame. Each zone gets three neighbouring rows so a
 * single bad line or compression artefact cannot skew the average.
 */
export function requiredRows(g: KeyboardGeometry): number[] {
  const zones = [g.impactRow, g.glowRow, g.depthRow];
  const rows = new Set<number>();
  for (const center of zones) {
    for (const offset of [-2, 0, 2]) {
      rows.add(Math.max(0, Math.min(g.imageHeight - 1, center + offset)));
    }
  }
  return [...rows].sort((a, b) => a - b);
}

/** Indices into the returned rows for each zone. */
export function rowZones(g: KeyboardGeometry): {
  impact: number[];
  glow: number[];
  depth: number[];
} {
  const rows = requiredRows(g);
  const indices = (center: number): number[] =>
    [-2, 0, 2]
      .map((o) => rows.indexOf(Math.max(0, Math.min(g.imageHeight - 1, center + o))))
      .filter((i) => i >= 0);
  return {
    impact: indices(g.impactRow),
    glow: indices(g.glowRow),
    depth: indices(g.depthRow),
  };
}
