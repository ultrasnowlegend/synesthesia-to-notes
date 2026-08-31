import type { Barva, GeometrieKlaviatury } from './typy.js';

/** Ktera z ulozenych vrstev stopy se ma cist. */
export type Vrstva = 'zar' | 'hloubka' | 'dopad';

/**
 * Casova stopa barev. Vznikne jedinym pruchodem videem a je to jediny
 * mezivysledek, ktery se uklada na disk: pro 88 klaves a deset minut pri 30 fps
 * zabere kolem 8 MB, takze ladeni prahu uz nemusi znovu dekodovat video.
 * Format je zamerne holy Uint8Array, ne pole objektu.
 */
export interface Stopa {
  fps: number;
  pocetSnimku: number;
  /** MIDI cisla klaves v poradi, ve kterem jsou ulozeny sloupce. */
  midi: number[];
  /** Zar na klavese; hlavni signal. Index (snimek * n + klavesa) * 3. */
  zar: Uint8Array;
  /** Radek hloubeji v klaviature; z odstupu od zare vychazi rychlost padu. */
  hloubka: Uint8Array;
  /** Radek nad klaviaturou; pruh sem dorazi driv, nez dosedne na klavesy. */
  dopad: Uint8Array;
}

export function pocetKlaves(s: Stopa): number {
  return s.midi.length;
}

export function barva(s: Stopa, vrstva: Vrstva, snimek: number, klavesa: number): Barva {
  const pole = s[vrstva];
  const i = (snimek * s.midi.length + klavesa) * 3;
  return { r: pole[i]!, g: pole[i + 1]!, b: pole[i + 2]! };
}

export function prazdnaStopa(g: GeometrieKlaviatury, fps: number, pocetSnimku: number): Stopa {
  const n = g.klavesy.length;
  const velikost = pocetSnimku * n * 3;
  return {
    fps,
    pocetSnimku,
    midi: g.klavesy.map((k) => k.midi),
    zar: new Uint8Array(velikost),
    hloubka: new Uint8Array(velikost),
    dopad: new Uint8Array(velikost),
  };
}

export function zapisBarvu(
  cil: Uint8Array,
  snimek: number,
  klavesa: number,
  pocetSloupcu: number,
  b: Barva,
): void {
  const i = (snimek * pocetSloupcu + klavesa) * 3;
  cil[i] = Math.round(b.r);
  cil[i + 1] = Math.round(b.g);
  cil[i + 2] = Math.round(b.b);
}
