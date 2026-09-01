import { fft } from './fourier.js';
import type { Udalost } from './typy.js';

/**
 * Urceni oktavy ze zvuku.
 *
 * Obraz rekne jednoznacne, ktera klavesa se hraje, ale ne, ktera to je nota:
 * u zaberu, kde je videt jen vyrez klaviatury, neni z ceho odvodit oktavu.
 * Rozlozeni klaves urci vysku tonu az na nasobek oktavy a zbytek musi doplnit
 * zvuk.
 *
 * Nestaci pritom scitat energii na ocekavanych frekvencich: kdyz odhad lezi
 * o oktavu vys, trefi se na druhou harmonickou skutecneho tonu, kde energie
 * take je. Proto se od skore odecita energie o oktavu niz — u spravneho odhadu
 * tam nic neni, u prilis vysokeho tam lezi skutecny zakladni ton.
 */

export interface NastaveniOktavy {
  vzorkovani?: number;
  /** Delka okna FFT; delsi okno lepe rozliseni v basech. */
  okno?: number;
  /** Kolik okamziku z nahravky prozkoumat. */
  vzorku?: number;
  /** Kandidati posunu v pultonech. */
  kandidati?: number[];
}

const VYCHOZI = {
  vzorkovani: 22050,
  okno: 8192,
  vzorku: 200,
  kandidati: [-24, -12, 0, 12, 24],
} as const;

export interface VysledekOktavy {
  /** O kolik pultonu posunout nalezene noty. Nula znamena, ze obraz sedel. */
  posun: number;
  /** Nakolik vitez prevysil druheho v poradi, 0..1. */
  jistota: number;
  skore: { posun: number; hodnota: number }[];
}

function frekvence(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Nejvyssi velikost v okoli dane frekvence; okoli kryje mirne rozladeni. */
function velikostU(spektrum: Float64Array, frekvenceHz: number, naBin: number): number {
  const stred = frekvenceHz / naBin;
  let max = 0;
  for (let i = Math.floor(stred) - 2; i <= Math.ceil(stred) + 2; i++) {
    if (i > 0 && i < spektrum.length) max = Math.max(max, spektrum[i]!);
  }
  return max;
}

export function urciOktavovyPosun(
  vzorky: Float32Array,
  udalosti: readonly Udalost[],
  nastaveni: NastaveniOktavy = {},
): VysledekOktavy {
  const vzorkovani = nastaveni.vzorkovani ?? VYCHOZI.vzorkovani;
  const okno = nastaveni.okno ?? VYCHOZI.okno;
  const kandidati = nastaveni.kandidati ?? VYCHOZI.kandidati;
  const prazdny = { posun: 0, jistota: 0, skore: [] };
  if (udalosti.length < 10 || vzorky.length < okno * 2) return prazdny;

  // Okamziky vybirame tesne po zacatku noty, kde je zakladni ton nejsilnejsi.
  const razene = [...udalosti].sort((a, b) => a.start - b.start);
  const krok = Math.max(1, Math.floor(razene.length / (nastaveni.vzorku ?? VYCHOZI.vzorku)));
  const okamziky: { cas: number; vysky: number[] }[] = [];
  for (let i = 0; i < razene.length; i += krok) {
    const u = razene[i]!;
    const cas = u.start + 0.04;
    const znejici = razene
      .filter((v) => v.start <= cas && v.konec > cas)
      .map((v) => v.midi)
      .slice(0, 6);
    if (znejici.length > 0) okamziky.push({ cas, vysky: znejici });
  }
  if (okamziky.length < 8) return prazdny;

  const hann = new Float64Array(okno);
  for (let i = 0; i < okno; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / okno);
  const naBin = vzorkovani / okno;

  const soucty = new Map<number, number>(kandidati.map((k) => [k, 0]));
  const re = new Float64Array(okno);
  const im = new Float64Array(okno);
  let pouzito = 0;

  for (const o of okamziky) {
    const start = Math.round(o.cas * vzorkovani);
    if (start < 0 || start + okno >= vzorky.length) continue;
    for (let i = 0; i < okno; i++) {
      re[i] = (vzorky[start + i] ?? 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const spektrum = new Float64Array(okno / 2);
    let celkem = 0;
    for (let i = 0; i < okno / 2; i++) {
      spektrum[i] = Math.hypot(re[i]!, im[i]!);
      celkem += spektrum[i]!;
    }
    if (celkem <= 0) continue;
    pouzito++;

    for (const posun of kandidati) {
      let skore = 0;
      for (const midi of o.vysky) {
        const f = frekvence(midi + posun);
        if (f < naBin * 3 || f > vzorkovani / 2.5) continue;
        skore += velikostU(spektrum, f, naBin) - velikostU(spektrum, f / 2, naBin);
      }
      soucty.set(posun, soucty.get(posun)! + skore / celkem);
    }
  }

  if (pouzito < 8) return prazdny;

  const skore = [...soucty.entries()]
    .map(([posun, hodnota]) => ({ posun, hodnota: hodnota / pouzito }))
    .sort((a, b) => b.hodnota - a.hodnota);
  const vitez = skore[0]!;
  const druhy = skore[1];
  const jistota =
    druhy && vitez.hodnota > 0 ? Math.max(0, (vitez.hodnota - druhy.hodnota) / vitez.hodnota) : 0;

  return { posun: vitez.posun, jistota, skore };
}
