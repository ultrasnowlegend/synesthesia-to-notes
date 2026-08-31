import type { Nota } from './typy.js';

/** Krumhansl-Kesslerovy profily durove a mollove toniny. */
const PROFIL_DUR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFIL_MOLL = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Pocet posunek durove tonice dane tridy; zapornou hodnotou jsou bemoly. */
const KVINTY_DUR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export interface Tonina {
  /** Kladne = krizky, zaporne = bemoly. */
  kvinty: number;
  tonika: number;
  mol: boolean;
  /** Korelace s profilem, 0..1. */
  shoda: number;
}

function korelace(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const prumerA = a.reduce((s, v) => s + v, 0) / n;
  const prumerB = b.reduce((s, v) => s + v, 0) / n;
  let citatel = 0;
  let rozptylA = 0;
  let rozptylB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - prumerA;
    const db = b[i]! - prumerB;
    citatel += da * db;
    rozptylA += da * da;
    rozptylB += db * db;
  }
  const jmenovatel = Math.sqrt(rozptylA * rozptylB);
  return jmenovatel === 0 ? 0 : citatel / jmenovatel;
}

/** Odhad toniny z histogramu tridy tonu vazeneho delkou not. */
export function odhadniToninu(noty: readonly Nota[]): Tonina {
  const histogram = new Array<number>(12).fill(0);
  for (const n of noty) histogram[n.midi % 12]! += n.delka;

  let nejlepsi: Tonina = { kvinty: 0, tonika: 0, mol: false, shoda: 0 };
  for (let tonika = 0; tonika < 12; tonika++) {
    const otoceny = histogram.map((_, i) => histogram[(i + tonika) % 12]!);
    for (const mol of [false, true]) {
      const shoda = korelace(otoceny, mol ? PROFIL_MOLL : PROFIL_DUR);
      if (shoda > nejlepsi.shoda) {
        // U moll pouzivame predznamenani paralelni dur, ktera lezi o tercii vyse.
        const kvinty = mol ? KVINTY_DUR[(tonika + 3) % 12]! : KVINTY_DUR[tonika]!;
        nejlepsi = { kvinty, tonika, mol, shoda };
      }
    }
  }
  return nejlepsi;
}

const KRIZKOVE = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'] as const;
const KRIZKOVE_POSUV = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const BEMOLOVE = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'] as const;
const BEMOLOVE_POSUV = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

export interface ZapisTonu {
  /** Pismeno v anglickem znaceni, tedy H se zapisuje jako B. */
  krok: string;
  /** -1 bemol, 0 bez posunky, 1 krizek. */
  posuv: number;
  oktava: number;
}

/** Prevede MIDI cislo na notovy zapis; smer posunek se ridi predznamenanim. */
export function zapisTonu(midi: number, kvinty: number): ZapisTonu {
  const trida = ((midi % 12) + 12) % 12;
  const bemoly = kvinty < 0;
  const krok = (bemoly ? BEMOLOVE : KRIZKOVE)[trida]!;
  const posuv = (bemoly ? BEMOLOVE_POSUV : KRIZKOVE_POSUV)[trida]!;
  // Ces a Bis by posunuly oktavu; v nasem zjednodusenem zapisu k nim nedochazi.
  const oktava = Math.floor(midi / 12) - 1;
  return { krok, posuv, oktava };
}
