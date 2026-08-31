import type { Barva, GeometrieKlaviatury } from './typy.js';

/**
 * Casova stopa barev jednotlivych klaves. Vznikne jedinym pruchodem videem a je
 * to jediny mezivysledek, ktery se uklada na disk: pro 88 klaves a deset minut
 * pri 30 fps zabere kolem 5 MB, takze ladeni prahu uz nemusi znovu dekodovat
 * video. Format je zamerne holy Uint8Array, ne pole objektu.
 */
export interface Stopa {
  fps: number;
  pocetSnimku: number;
  /** MIDI cisla klaves v poradi, ve kterem jsou ulozeny sloupce. */
  midi: number[];
  /** Barva tela klavesy: data[(snimek * pocetKlaves + klavesa) * 3 + slozka]. */
  klavesy: Uint8Array;
  /** Barva radku tesne nad klaviaturou, kde dopadaji pruhy. Stejny format. */
  dopad: Uint8Array;
}

export function pocetKlaves(s: Stopa): number {
  return s.midi.length;
}

export function barvaKlavesy(s: Stopa, snimek: number, klavesa: number): Barva {
  const i = (snimek * s.midi.length + klavesa) * 3;
  return { r: s.klavesy[i]!, g: s.klavesy[i + 1]!, b: s.klavesy[i + 2]! };
}

export function barvaDopadu(s: Stopa, snimek: number, klavesa: number): Barva {
  const i = (snimek * s.midi.length + klavesa) * 3;
  return { r: s.dopad[i]!, g: s.dopad[i + 1]!, b: s.dopad[i + 2]! };
}

export function prazdnaStopa(g: GeometrieKlaviatury, fps: number, pocetSnimku: number): Stopa {
  const n = g.klavesy.length;
  return {
    fps,
    pocetSnimku,
    midi: g.klavesy.map((k) => k.midi),
    klavesy: new Uint8Array(pocetSnimku * n * 3),
    dopad: new Uint8Array(pocetSnimku * n * 3),
  };
}

export function zapisBarvu(cil: Uint8Array, snimek: number, klavesa: number, pocet: number, b: Barva): void {
  const i = (snimek * pocet + klavesa) * 3;
  cil[i] = Math.round(b.r);
  cil[i + 1] = Math.round(b.g);
  cil[i + 2] = Math.round(b.b);
}
