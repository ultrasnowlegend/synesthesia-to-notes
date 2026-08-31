import type { Obraz } from './obraz.js';
import type { GeometrieKlaviatury, Udalost } from './typy.js';

/**
 * Obrazky, na kterych je videt, co aplikace v obraze nasla. Kalibrace je jedina
 * cast retezce, kterou nejde overit zvukem, takze musi jit zkontrolovat okem.
 */

export interface Plocha {
  sirka: number;
  vyska: number;
  data: Uint8Array;
}

function bod(p: Plocha, x: number, y: number, r: number, g: number, b: number, kryti = 1): void {
  if (x < 0 || x >= p.sirka || y < 0 || y >= p.vyska) return;
  const i = (y * p.sirka + x) * 3;
  p.data[i] = p.data[i]! + (r - p.data[i]!) * kryti;
  p.data[i + 1] = p.data[i + 1]! + (g - p.data[i + 1]!) * kryti;
  p.data[i + 2] = p.data[i + 2]! + (b - p.data[i + 2]!) * kryti;
}

function pruh(p: Plocha, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, kryti = 1): void {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) bod(p, x, y, r, g, b, kryti);
}

/**
 * Klidovy snimek s vyznacenym vyhradnim pruhem kazde klavesy a znackami u C.
 * Kdyz znacky sedi na spravnych klavesach, sedi cela kalibrace.
 */
export function nakresliKalibraci(g: GeometrieKlaviatury, pozadi: Obraz): Plocha {
  const odY = Math.max(0, g.radekDopadu - 24);
  const doY = Math.min(pozadi.vyska - 1, g.dolniHrana + 8);
  const vyska = doY - odY + 1;
  const p: Plocha = { sirka: pozadi.sirka, vyska, data: new Uint8Array(pozadi.sirka * vyska * 3) };
  for (let y = 0; y < vyska; y++) {
    const zdroj = (odY + y) * pozadi.sirka * 3;
    p.data.set(pozadi.data.subarray(zdroj, zdroj + pozadi.sirka * 3), y * pozadi.sirka * 3);
  }

  const zar = g.radekZare - odY;
  for (const k of g.klavesy) {
    const [r, gg, b] = k.cerna ? [90, 200, 255] : [255, 150, 60];
    pruh(p, k.vx1, zar - 2, k.vx2, zar + 2, r, gg, b, 0.85);
  }
  for (const k of g.klavesy) {
    if (k.midi % 12 !== 0) continue;
    const x = Math.round(k.stred);
    pruh(p, x - 1, g.dolniHrana - odY - 26, x, g.dolniHrana - odY, 255, 70, 220, 0.9);
  }
  return p;
}

/** Nalezene noty jako klavirni rolka pres celou delku nahravky. */
export function nakresliRolku(udalosti: readonly Udalost[], delka: number, sirka = 1200): Plocha {
  const odMidi = 21;
  const doMidi = 108;
  const vyskaKlavesy = 3;
  const vyska = (doMidi - odMidi + 1) * vyskaKlavesy;
  const p: Plocha = { sirka, vyska, data: new Uint8Array(sirka * vyska * 3) };
  pruh(p, 0, 0, sirka - 1, vyska - 1, 16, 18, 24);

  for (let m = odMidi; m <= doMidi; m++) {
    if (m % 12 !== 0) continue;
    const y = (doMidi - m) * vyskaKlavesy;
    pruh(p, 0, y, sirka - 1, y, 40, 44, 54);
  }

  for (const u of udalosti) {
    const x1 = Math.round((u.start / delka) * (sirka - 1));
    const x2 = Math.max(x1, Math.round((u.konec / delka) * (sirka - 1)));
    const y = (doMidi - Math.max(odMidi, Math.min(doMidi, u.midi))) * vyskaKlavesy;
    const [r, g, b] = u.ruka === 'leva' ? [70, 200, 175] : [240, 170, 70];
    pruh(p, x1, y, x2, y + vyskaKlavesy - 2, r, g, b);
  }
  return p;
}
