import type { Barva } from './typy.js';

/** Snimek v syrovem rgb24 (tri bajty na pixel, bez zarovnani radku). */
export interface Obraz {
  sirka: number;
  vyska: number;
  data: Uint8Array;
}

export function pixel(o: Obraz, x: number, y: number): Barva {
  const i = (y * o.sirka + x) * 3;
  return { r: o.data[i]!, g: o.data[i + 1]!, b: o.data[i + 2]! };
}

/** Vyrez jednoho radku jako pole barev. */
export function radek(o: Obraz, y: number): Barva[] {
  const out: Barva[] = new Array(o.sirka);
  const zacatek = y * o.sirka * 3;
  for (let x = 0; x < o.sirka; x++) {
    const i = zacatek + x * 3;
    out[x] = { r: o.data[i]!, g: o.data[i + 1]!, b: o.data[i + 2]! };
  }
  return out;
}

/**
 * Median z nekolika snimku po pixelech. Pouziva se k ziskani "klidoveho"
 * obrazu klaviatury: kdyz vzorky pokryvaji cele video, zadna klavesa neni
 * rozsvicena ve vice nez polovine z nich, takze median ukaze holou klaviaturu
 * i u videa, kde se nikdy nehraje uplne ticho.
 */
export function medianSnimku(snimky: readonly Obraz[]): Obraz {
  const prvni = snimky[0];
  if (!prvni) throw new Error('medianSnimku: prazdny vstup');
  const n = snimky.length;
  const delka = prvni.data.length;
  const out = new Uint8Array(delka);
  const buf = new Uint8Array(n);
  for (let i = 0; i < delka; i++) {
    for (let s = 0; s < n; s++) buf[s] = snimky[s]!.data[i]!;
    const serazene = Array.from(buf).sort((a, b) => a - b);
    out[i] = serazene[n >> 1]!;
  }
  return { sirka: prvni.sirka, vyska: prvni.vyska, data: out };
}

/**
 * Prahovani metodou Otsu nad histogramem jasu 0..255. Vraci hodnotu na pul cesty
 * mezi posledni tridou pozadi a prvni tridou popredi, aby porovnani `hodnota >
 * prah` sedelo i pro necela cisla, ze kterych se histogram zaokrouhloval.
 */
export function otsu(hodnoty: readonly number[]): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of hodnoty) hist[Math.max(0, Math.min(255, Math.round(v)))]!++;
  const celkem = hodnoty.length;
  let sumaVse = 0;
  for (let i = 0; i < 256; i++) sumaVse += i * hist[i]!;
  let sumaPozadi = 0;
  let vahaPozadi = 0;
  let nejlepsiRozptyl = -1;
  let prah = 128;
  for (let t = 0; t < 256; t++) {
    vahaPozadi += hist[t]!;
    if (vahaPozadi === 0) continue;
    const vahaPopredi = celkem - vahaPozadi;
    if (vahaPopredi === 0) break;
    sumaPozadi += t * hist[t]!;
    const stredPozadi = sumaPozadi / vahaPozadi;
    const stredPopredi = (sumaVse - sumaPozadi) / vahaPopredi;
    const rozdil = stredPozadi - stredPopredi;
    const rozptyl = vahaPozadi * vahaPopredi * rozdil * rozdil;
    if (rozptyl > nejlepsiRozptyl) {
      nejlepsiRozptyl = rozptyl;
      prah = t;
    }
  }
  return prah + 0.5;
}

export interface Usek {
  x1: number;
  x2: number;
  sirka: number;
  stred: number;
}

/** Souvisle useky, kde plati predikat. */
export function useky(delka: number, plati: (x: number) => boolean): Usek[] {
  const out: Usek[] = [];
  let zacatek = -1;
  for (let x = 0; x < delka; x++) {
    if (plati(x)) {
      if (zacatek < 0) zacatek = x;
    } else if (zacatek >= 0) {
      out.push({ x1: zacatek, x2: x - 1, sirka: x - zacatek, stred: (zacatek + x - 1) / 2 });
      zacatek = -1;
    }
  }
  if (zacatek >= 0) {
    out.push({ x1: zacatek, x2: delka - 1, sirka: delka - zacatek, stred: (zacatek + delka - 1) / 2 });
  }
  return out;
}

export function median(v: readonly number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2;
}
