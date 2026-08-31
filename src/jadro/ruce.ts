import { vzdalenostBarev } from './barvy.js';
import { median } from './obraz.js';
import type { Barva, DrahyRukou, GeometrieKlaviatury, Udalost } from './typy.js';

/**
 * Zmenseny pas klaviatury, snimek po snimku. Hledaji se v nem dve velke skvrny,
 * ne detaily, takze 320 x 24 px bohate staci a cely pas se vejde do pameti.
 */
export interface PasKlaviatury {
  sirka: number;
  vyska: number;
  pocetSnimku: number;
  /** rgb24, po snimcich: ((snimek * vyska + y) * sirka + x) * 3. */
  data: Uint8Array;
  /** x v puvodnim videu = posunX + x * meritko. */
  posunX: number;
  meritko: number;
}

export interface NastaveniRukou {
  /** Podil radku sloupce, ktery musi byt zmeneny, aby tam ruka byla. */
  prahObsazenosti?: number;
  /** Nejuzsi skvrna, ktera se jeste bere jako ruka; v pixelech pasu. */
  minSirka?: number;
  /** Delka klouzaveho prumeru pri vyhlazovani obsazenosti. */
  vyhlazeni?: number;
}

const VYCHOZI = { prahObsazenosti: 0.3, minSirka: 5, vyhlazeni: 5 } as const;

function pixel(pas: PasKlaviatury, snimek: number, x: number, y: number): Barva {
  const i = ((snimek * pas.vyska + y) * pas.sirka + x) * 3;
  return { r: pas.data[i]!, g: pas.data[i + 1]!, b: pas.data[i + 2]! };
}

/** Klidovy pas: v kazdem pixelu je vetsinu casu klaviatura, ne ruka. */
export function pozadiPasu(pas: PasKlaviatury, vzorku = 200): Uint8Array {
  const krok = Math.max(1, Math.floor(pas.pocetSnimku / vzorku));
  const snimky: number[] = [];
  for (let f = 0; f < pas.pocetSnimku; f += krok) snimky.push(f);

  const velikost = pas.sirka * pas.vyska * 3;
  const out = new Uint8Array(velikost);
  const buf: number[] = new Array(snimky.length);
  for (let i = 0; i < velikost; i++) {
    for (let s = 0; s < snimky.length; s++) {
      buf[s] = pas.data[snimky[s]! * velikost + i]!;
    }
    out[i] = median(buf);
  }
  return out;
}

/** Podil zmenenych pixelu v kazdem sloupci pasu, snimek po snimku. */
export function obsazenostSloupcu(
  pas: PasKlaviatury,
  pozadi: Uint8Array,
  prahBarvy = 0.12,
): Float32Array {
  const out = new Float32Array(pas.pocetSnimku * pas.sirka);
  for (let f = 0; f < pas.pocetSnimku; f++) {
    for (let x = 0; x < pas.sirka; x++) {
      let zmenenych = 0;
      for (let y = 0; y < pas.vyska; y++) {
        const j = ((y * pas.sirka) + x) * 3;
        const klid: Barva = { r: pozadi[j]!, g: pozadi[j + 1]!, b: pozadi[j + 2]! };
        if (vzdalenostBarev(pixel(pas, f, x, y), klid) > prahBarvy) zmenenych++;
      }
      out[f * pas.sirka + x] = zmenenych / pas.vyska;
    }
  }
  return out;
}

function klouzavyPrumer(hodnoty: Float32Array, od: number, delka: number, okno: number): Float32Array {
  const out = new Float32Array(delka);
  const polovina = okno >> 1;
  for (let i = 0; i < delka; i++) {
    let soucet = 0;
    let pocet = 0;
    for (let d = -polovina; d <= polovina; d++) {
      const j = i + d;
      if (j >= 0 && j < delka) {
        soucet += hodnoty[od + j]!;
        pocet++;
      }
    }
    out[i] = soucet / pocet;
  }
  return out;
}

interface Skvrna {
  od: number;
  do: number;
  teziste: number;
  hmota: number;
}

function skvrny(profil: Float32Array, prah: number, minSirka: number): Skvrna[] {
  const out: Skvrna[] = [];
  let od = -1;
  for (let x = 0; x <= profil.length; x++) {
    const nad = x < profil.length && profil[x]! > prah;
    if (nad && od < 0) od = x;
    if (!nad && od >= 0) {
      const doX = x - 1;
      if (doX - od + 1 >= minSirka) {
        let hmota = 0;
        let vazene = 0;
        for (let i = od; i <= doX; i++) {
          hmota += profil[i]!;
          vazene += profil[i]! * i;
        }
        out.push({ od, do: doX, teziste: vazene / hmota, hmota });
      }
      od = -1;
    }
  }
  return out;
}

/**
 * Dve drahy rukou v case. Kdyz splynou do jedne skvrny, rozdeli se v jejim
 * stredu; kdyz zmizi uplne, hodnota zustane nedefinovana a doplni se az
 * dodatecne z okoli. Prohozeni rukou se nepripousti.
 */
export function sledujRuce(
  pas: PasKlaviatury,
  nastaveni: NastaveniRukou = {},
): DrahyRukou {
  const prah = nastaveni.prahObsazenosti ?? VYCHOZI.prahObsazenosti;
  const minSirka = nastaveni.minSirka ?? VYCHOZI.minSirka;
  const okno = nastaveni.vyhlazeni ?? VYCHOZI.vyhlazeni;

  const pozadi = pozadiPasu(pas);
  const obsazenost = obsazenostSloupcu(pas, pozadi);
  const x = new Float32Array(pas.pocetSnimku * 2).fill(NaN);

  const typickaSirka = median(
    (() => {
      const sirky: number[] = [];
      for (let f = 0; f < pas.pocetSnimku; f += Math.max(1, Math.floor(pas.pocetSnimku / 200))) {
        const profil = klouzavyPrumer(obsazenost, f * pas.sirka, pas.sirka, okno);
        for (const s of skvrny(profil, prah, minSirka)) sirky.push(s.do - s.od + 1);
      }
      return sirky.length ? sirky : [minSirka * 2];
    })(),
  );

  for (let f = 0; f < pas.pocetSnimku; f++) {
    const profil = klouzavyPrumer(obsazenost, f * pas.sirka, pas.sirka, okno);
    const nalezene = skvrny(profil, prah, minSirka);

    if (nalezene.length >= 2) {
      const dve = [...nalezene].sort((a, b) => b.hmota - a.hmota).slice(0, 2);
      dve.sort((a, b) => a.teziste - b.teziste);
      x[f * 2] = dve[0]!.teziste;
      x[f * 2 + 1] = dve[1]!.teziste;
    } else if (nalezene.length === 1) {
      const s = nalezene[0]!;
      const sirka = s.do - s.od + 1;
      if (sirka > typickaSirka * 1.7) {
        // Ruce se dotkly a splynuly v jednu skvrnu; delime ji v polovine.
        x[f * 2] = (s.od + s.teziste) / 2;
        x[f * 2 + 1] = (s.teziste + s.do) / 2;
      } else {
        const predchoziL = f > 0 ? x[(f - 1) * 2]! : NaN;
        const predchoziP = f > 0 ? x[(f - 1) * 2 + 1]! : NaN;
        const kLeve = Number.isFinite(predchoziL) ? Math.abs(s.teziste - predchoziL) : Infinity;
        const kPrave = Number.isFinite(predchoziP) ? Math.abs(s.teziste - predchoziP) : Infinity;
        if (kLeve <= kPrave) x[f * 2] = s.teziste;
        else x[f * 2 + 1] = s.teziste;
      }
    }
  }

  doplnMezery(x, pas.pocetSnimku);
  for (let f = 0; f < pas.pocetSnimku; f++) {
    const l = x[f * 2]!;
    const p = x[f * 2 + 1]!;
    if (Number.isFinite(l) && Number.isFinite(p) && l > p) {
      x[f * 2] = p;
      x[f * 2 + 1] = l;
    }
    // Prepocet do souradnic puvodniho videa az na konci, aby vyhlazovani
    // probihalo v jednotkach pasu.
    x[f * 2] = pas.posunX + x[f * 2]! * pas.meritko;
    x[f * 2 + 1] = pas.posunX + x[f * 2 + 1]! * pas.meritko;
  }

  return { pocetSnimku: pas.pocetSnimku, x };
}

/** Chybejici hodnoty doplni lineárně mezi nejblizsimi znamymi snimky. */
function doplnMezery(x: Float32Array, pocetSnimku: number): void {
  for (const posun of [0, 1]) {
    let posledniZnamy = -1;
    for (let f = 0; f < pocetSnimku; f++) {
      const i = f * 2 + posun;
      if (!Number.isFinite(x[i]!)) continue;
      if (posledniZnamy >= 0 && f - posledniZnamy > 1) {
        const od = x[posledniZnamy * 2 + posun]!;
        const doH = x[i]!;
        for (let g = posledniZnamy + 1; g < f; g++) {
          const t = (g - posledniZnamy) / (f - posledniZnamy);
          x[g * 2 + posun] = od + (doH - od) * t;
        }
      }
      posledniZnamy = f;
    }
    if (posledniZnamy < 0) continue;
    for (let f = 0; f < pocetSnimku; f++) {
      const i = f * 2 + posun;
      if (!Number.isFinite(x[i]!)) {
        x[i] = f < posledniZnamy ? x[nejblizsiZnamy(x, pocetSnimku, posun, f)! * 2 + posun]! : x[posledniZnamy * 2 + posun]!;
      }
    }
  }
}

function nejblizsiZnamy(
  x: Float32Array,
  pocetSnimku: number,
  posun: number,
  od: number,
): number | null {
  for (let f = od; f < pocetSnimku; f++) {
    if (Number.isFinite(x[f * 2 + posun]!)) return f;
  }
  return null;
}

/**
 * Priradi kazde udalosti ruku podle toho, ktera byla v okamziku uderu bliz.
 * Udalosti, ktere uz ruku maji z barvy pruhu, se nemeni.
 */
export function prirazeniPodlePolohy(
  udalosti: Udalost[],
  drahy: DrahyRukou,
  geometrie: GeometrieKlaviatury,
  fps: number,
): void {
  const stredKlavesy = new Map<number, number>();
  for (const k of geometrie.klavesy) stredKlavesy.set(k.midi, k.stred);

  for (const u of udalosti) {
    if (u.ruka !== 'neznama') continue;
    const stred = stredKlavesy.get(u.midi);
    if (stred === undefined) continue;
    const snimek = Math.min(drahy.pocetSnimku - 1, Math.max(0, Math.round(u.start * fps)));
    const leva = drahy.x[snimek * 2]!;
    const prava = drahy.x[snimek * 2 + 1]!;
    const dL = Number.isFinite(leva) ? Math.abs(stred - leva) : Infinity;
    const dP = Number.isFinite(prava) ? Math.abs(stred - prava) : Infinity;
    if (dL === Infinity && dP === Infinity) continue;
    u.ruka = dL <= dP ? 'leva' : 'prava';
  }
}
