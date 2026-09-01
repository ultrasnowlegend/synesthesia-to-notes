import type { Color } from './types.js';

/** Brightness 0..255 by perceived lightness, not by the mean of the channels. */
export function luma(c: Color): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/** Saturation 0..1 in the HSV model. */
export function saturation(c: Color): number {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Hue in degrees 0..360; grey returns 0. */
export function hue(c: Color): number {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Distance between two hues around the circle, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Distance between two colours normalised to 0..1. Deliberately not the
 * Euclidean distance in RGB: lighting a key changes mostly saturation and hue,
 * whereas the shadow of a hand over the keyboard changes mostly brightness.
 * Brightness therefore carries far less weight — otherwise every shadow would
 * look like a pressed key.
 */
export function colorDistance(a: Color, b: Color): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const dLuma = (0.299 * dr + 0.587 * dg + 0.114 * db) / 255;
  const dR = dr / 255 - dLuma;
  const dG = dg / 255 - dLuma;
  const dB = db / 255 - dLuma;
  const chroma = Math.sqrt(dR * dR + dG * dG + dB * dB);
  return Math.min(1, Math.sqrt(chroma * chroma + 0.15 * dLuma * dLuma));
}

export function meanColor(colors: readonly Color[]): Color {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colors) {
    r += c.r;
    g += c.g;
    b += c.b;
  }
  const n = colors.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Per-channel median; robust against a covering finger or a transitional frame. */
export function medianColor(colors: readonly Color[]): Color {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  const channel = (pick: (c: Color) => number): number => {
    const v = colors.map(pick).sort((x, y) => x - y);
    const i = v.length >> 1;
    return v.length % 2 ? v[i]! : (v[i - 1]! + v[i]!) / 2;
  };
  return { r: channel((c) => c.r), g: channel((c) => c.g), b: channel((c) => c.b) };
}
