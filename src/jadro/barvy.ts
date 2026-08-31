import type { Barva } from './typy.js';

/** Jas 0..255 podle vnimane svetlosti, ne prumeru slozek. */
export function jas(b: Barva): number {
  return 0.299 * b.r + 0.587 * b.g + 0.114 * b.b;
}

/** Sytost 0..1 v modelu HSV. */
export function sytost(b: Barva): number {
  const max = Math.max(b.r, b.g, b.b);
  const min = Math.min(b.r, b.g, b.b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Odstin ve stupnich 0..360; pro sedou vraci 0. */
export function odstin(b: Barva): number {
  const max = Math.max(b.r, b.g, b.b);
  const min = Math.min(b.r, b.g, b.b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === b.r) h = ((b.g - b.b) / d) % 6;
  else if (max === b.g) h = (b.b - b.r) / d + 2;
  else h = (b.r - b.g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Vzdalenost odstinu po kruhu, 0..180. */
export function rozdilOdstinu(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Vzdalenost dvou barev normalizovana na 0..1. Zamerne neni to euklidovska
 * vzdalenost v RGB: rozsviceni klavesy meni predevsim sytost a odstin, kdezto
 * stin ruky nad klaviaturou meni hlavne jas. Jasu proto davame mensi vahu,
 * jinak by kazdy stin vypadal jako stisknuta klavesa.
 */
export function vzdalenostBarev(a: Barva, b: Barva): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const dJas = (0.299 * dr + 0.587 * dg + 0.114 * db) / 255;
  const dR = dr / 255 - dJas;
  const dG = dg / 255 - dJas;
  const dB = db / 255 - dJas;
  const chroma = Math.sqrt(dR * dR + dG * dG + dB * dB);
  return Math.min(1, Math.sqrt(chroma * chroma + 0.15 * dJas * dJas));
}

export function prumerBarev(barvy: readonly Barva[]): Barva {
  if (barvy.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of barvy) {
    r += c.r;
    g += c.g;
    b += c.b;
  }
  const n = barvy.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Median po slozkach; odolny vuci prekrytu prstem nebo prechodovemu snimku. */
export function medianBarev(barvy: readonly Barva[]): Barva {
  if (barvy.length === 0) return { r: 0, g: 0, b: 0 };
  const slozka = (vyber: (c: Barva) => number): number => {
    const v = barvy.map(vyber).sort((x, y) => x - y);
    const i = v.length >> 1;
    return v.length % 2 ? v[i]! : (v[i - 1]! + v[i]!) / 2;
  };
  return { r: slozka((c) => c.r), g: slozka((c) => c.g), b: slozka((c) => c.b) };
}
