import type { Barva, GeometrieKlaviatury } from './typy.js';

/** Ktera z ulozenych vrstev stopy se ma cist. */
export type Vrstva = 'dopad' | 'vyssi' | 'klavesy';

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
  /** Radek tesne nad klaviaturou; hlavni signal. Index (snimek * n + klavesa) * 3. */
  dopad: Uint8Array;
  /** Radek vyse nad klaviaturou; slouzi k mereni rychlosti padu pruhu. */
  vyssi: Uint8Array;
  /** Telo klavesy; u skutecneho klaviru casto pod prsty, proto jen kontrola. */
  klavesy: Uint8Array;
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
    dopad: new Uint8Array(velikost),
    vyssi: new Uint8Array(velikost),
    klavesy: new Uint8Array(velikost),
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
