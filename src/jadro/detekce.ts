import { medianBarev, odstin, sytost, vzdalenostBarev } from './barvy.js';
import { otsu } from './obraz.js';
import { barvaDopadu, barvaKlavesy, type Stopa } from './stopa.js';
import type { Barva, Ruka, Udalost } from './typy.js';

export interface NastaveniDetekce {
  /** Prah odchylky od klidove barvy, 0..1. Kdyz chybi, urci se z dat. */
  prah?: number;
  /** Kratsi zablesky nez tolik snimku zahazujeme jako sum. */
  minSnimku?: number;
  /** Mezery kratsi nez tolik snimku spojujeme; vznikaji vyhlazovanim hran. */
  spojMezeruSnimku?: number;
  /** Delit drzenou klavesu, kdyz nad ni dopadne novy pruh (opakovany ton). */
  deleniPodleDopadu?: boolean;
  /** Rozdelit noty na dve ruce podle barvy pruhu. */
  rozdeliRuce?: boolean;
}

const VYCHOZI = {
  minSnimku: 2,
  spojMezeruSnimku: 1,
  deleniPodleDopadu: true,
  rozdeliRuce: true,
} as const;

/**
 * Klidova barva kazde klavesy = median pres cele video. Klavesa je vetsinu casu
 * nestisknuta i v hustem hrani, takze median ukaze jeji holou barvu bez toho,
 * aby uzivatel musel hledat snimek s tichem.
 */
export function klidoveBarvy(stopa: Stopa, vzorku = 400): Barva[] {
  const n = stopa.midi.length;
  const krok = Math.max(1, Math.floor(stopa.pocetSnimku / vzorku));
  const out: Barva[] = [];
  for (let k = 0; k < n; k++) {
    const vzorky: Barva[] = [];
    for (let f = 0; f < stopa.pocetSnimku; f += krok) vzorky.push(barvaKlavesy(stopa, f, k));
    out.push(medianBarev(vzorky));
  }
  return out;
}

/** Odchylka barvy kazde klavesy od jeji klidove barvy, snimek po snimku. */
export function odchylky(stopa: Stopa, klid: readonly Barva[]): Float32Array {
  const n = stopa.midi.length;
  const out = new Float32Array(stopa.pocetSnimku * n);
  for (let f = 0; f < stopa.pocetSnimku; f++) {
    for (let k = 0; k < n; k++) {
      out[f * n + k] = vzdalenostBarev(barvaKlavesy(stopa, f, k), klid[k]!);
    }
  }
  return out;
}

/**
 * Prah mezi "klid" a "sviti" hleda Otsu nad rozdelenim vsech odchylek. Rucni
 * konstanta by nefungovala napric ruznymi vzhledy videa; spodni mez je tu jen
 * proto, aby video, kde se skoro nehraje, nezacalo videt noty v sumu kodeku.
 */
export function odhadniPrah(odch: Float32Array): number {
  const vzorku = Math.min(odch.length, 200_000);
  const krok = Math.max(1, Math.floor(odch.length / vzorku));
  const skala: number[] = [];
  for (let i = 0; i < odch.length; i += krok) skala.push(odch[i]! * 255);
  return Math.max(0.06, otsu(skala) / 255);
}

interface Beh {
  klavesa: number;
  od: number;
  do: number;
}

/** Souvisle useky, kde je klavesa rozsvicena, s vyhlazenim mezer a zablesku. */
function behy(
  sviti: (f: number, k: number) => boolean,
  pocetSnimku: number,
  pocetKlaves: number,
  minSnimku: number,
  spojMezeru: number,
): Beh[] {
  const out: Beh[] = [];
  for (let k = 0; k < pocetKlaves; k++) {
    let od = -1;
    let posledni = -1;
    for (let f = 0; f < pocetSnimku; f++) {
      if (sviti(f, k)) {
        if (od < 0) od = f;
        else if (f - posledni - 1 > spojMezeru) {
          if (posledni - od + 1 >= minSnimku) out.push({ klavesa: k, od, do: posledni });
          od = f;
        }
        posledni = f;
      }
    }
    if (od >= 0 && posledni - od + 1 >= minSnimku) out.push({ klavesa: k, od, do: posledni });
  }
  return out;
}

/**
 * Rozdeli drzeny beh tam, kde nad klavesou dopadne novy pruh. Bez toho by se
 * rychle opakovany ton, u ktereho klavesa mezi udery nezhasne, precetl jako
 * jedna dlouha nota.
 */
function rozdelPodleDopadu(beh: Beh, dopadSviti: (f: number, k: number) => boolean): Beh[] {
  const casti: Beh[] = [];
  let od = beh.od;
  let mezera = 0;
  for (let f = beh.od; f <= beh.do; f++) {
    if (!dopadSviti(f, beh.klavesa)) {
      mezera++;
      continue;
    }
    if (mezera >= 2 && f - od >= 2) {
      casti.push({ klavesa: beh.klavesa, od, do: f - 1 });
      od = f;
    }
    mezera = 0;
  }
  casti.push({ klavesa: beh.klavesa, od, do: beh.do });
  return casti;
}

interface Shluk {
  cos: number;
  sin: number;
  soucetMidi: number;
  pocet: number;
}

function stredniOdstin(s: Shluk): number {
  const h = (Math.atan2(s.sin, s.cos) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * Rozdeli barvy pruhu na dva shluky (leva/prava ruka) k-means na kruhu odstinu.
 * Kdyz jsou vysledne shluky odstinem blizko sebe, video zjevne obe ruce nerozlisuje
 * a vracime null, aby se rozdeleni udelalo az podle vysky tonu.
 */
function shlukyRukou(
  vzorky: readonly { odstin: number; midi: number }[],
): { levy: number; pravy: number } | null {
  if (vzorky.length < 20) return null;

  let a: Shluk = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };
  let b: Shluk = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };
  // Pocatecni stredy: dva nejvzdalenejsi odstiny v serazenem vzorku.
  const serazene = [...vzorky].sort((x, y) => x.odstin - y.odstin);
  let stredA = serazene[Math.floor(serazene.length * 0.15)]!.odstin;
  let stredB = serazene[Math.floor(serazene.length * 0.85)]!.odstin;

  for (let iterace = 0; iterace < 12; iterace++) {
    a = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };
    b = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };
    for (const v of vzorky) {
      const rad = (v.odstin * Math.PI) / 180;
      const dA = Math.abs(((v.odstin - stredA + 540) % 360) - 180);
      const dB = Math.abs(((v.odstin - stredB + 540) % 360) - 180);
      const cil = dA <= dB ? a : b;
      cil.cos += Math.cos(rad);
      cil.sin += Math.sin(rad);
      cil.soucetMidi += v.midi;
      cil.pocet++;
    }
    if (a.pocet === 0 || b.pocet === 0) return null;
    stredA = stredniOdstin(a);
    stredB = stredniOdstin(b);
  }

  const rozdil = Math.abs(((stredA - stredB + 540) % 360) - 180);
  if (rozdil < 25) return null;

  const prumerA = a.soucetMidi / a.pocet;
  const prumerB = b.soucetMidi / b.pocet;
  return prumerA <= prumerB ? { levy: stredA, pravy: stredB } : { levy: stredB, pravy: stredA };
}

export interface VysledekDetekce {
  udalosti: Udalost[];
  prah: number;
  klid: Barva[];
  /** Odstiny shluku rukou, kdyz se je podarilo rozlisit. */
  odstinyRukou: { levy: number; pravy: number } | null;
}

/** Prevede casovou stopu barev na seznam drzenych not. */
export function detekujUdalosti(stopa: Stopa, nastaveni: NastaveniDetekce = {}): VysledekDetekce {
  const n = stopa.midi.length;
  const minSnimku = nastaveni.minSnimku ?? VYCHOZI.minSnimku;
  const spojMezeru = nastaveni.spojMezeruSnimku ?? VYCHOZI.spojMezeruSnimku;

  const klid = klidoveBarvy(stopa);
  const odch = odchylky(stopa, klid);
  const prah = nastaveni.prah ?? odhadniPrah(odch);
  const sviti = (f: number, k: number): boolean => odch[f * n + k]! > prah;

  let vsechnyBehy = behy(sviti, stopa.pocetSnimku, n, minSnimku, spojMezeru);

  if (nastaveni.deleniPodleDopadu ?? VYCHOZI.deleniPodleDopadu) {
    const klidDopadu: Barva[] = [];
    for (let k = 0; k < n; k++) {
      const vzorky: Barva[] = [];
      const krok = Math.max(1, Math.floor(stopa.pocetSnimku / 400));
      for (let f = 0; f < stopa.pocetSnimku; f += krok) vzorky.push(barvaDopadu(stopa, f, k));
      klidDopadu.push(medianBarev(vzorky));
    }
    const dopadSviti = (f: number, k: number): boolean =>
      vzdalenostBarev(barvaDopadu(stopa, f, k), klidDopadu[k]!) > prah;
    vsechnyBehy = vsechnyBehy.flatMap((b) => rozdelPodleDopadu(b, dopadSviti));
  }

  // Barvy a jistota jednotlivych behu.
  const popis = vsechnyBehy.map((b) => {
    const barvy: Barva[] = [];
    let soucetOdchylky = 0;
    for (let f = b.od; f <= b.do; f++) {
      barvy.push(barvaKlavesy(stopa, f, b.klavesa));
      soucetOdchylky += odch[f * n + b.klavesa]!;
    }
    const barva = medianBarev(barvy);
    const delka = b.do - b.od + 1;
    return { beh: b, barva, jistota: Math.min(1, soucetOdchylky / delka / Math.max(prah, 1e-6) / 3) };
  });

  let odstinyRukou: { levy: number; pravy: number } | null = null;
  if (nastaveni.rozdeliRuce ?? VYCHOZI.rozdeliRuce) {
    const vzorky = popis
      .filter((p) => sytost(p.barva) > 0.25)
      .map((p) => ({ odstin: odstin(p.barva), midi: stopa.midi[p.beh.klavesa]! }));
    odstinyRukou = shlukyRukou(vzorky);
  }

  const udalosti: Udalost[] = popis.map((p) => {
    let ruka: Ruka = 'neznama';
    if (odstinyRukou && sytost(p.barva) > 0.2) {
      const h = odstin(p.barva);
      const dL = Math.abs(((h - odstinyRukou.levy + 540) % 360) - 180);
      const dP = Math.abs(((h - odstinyRukou.pravy + 540) % 360) - 180);
      ruka = dL <= dP ? 'leva' : 'prava';
    }
    return {
      midi: stopa.midi[p.beh.klavesa]!,
      start: p.beh.od / stopa.fps,
      konec: (p.beh.do + 1) / stopa.fps,
      ruka,
      barva: p.barva,
      jistota: p.jistota,
    };
  });

  udalosti.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { udalosti, prah, klid, odstinyRukou };
}

/** Zaloha, kdyz video obe ruce nerozlisuje barvou: deli se podle vysky tonu. */
export function rozdelPodleVysky(udalosti: Udalost[], delicBod: number): void {
  for (const u of udalosti) {
    if (u.ruka === 'neznama') u.ruka = u.midi < delicBod ? 'leva' : 'prava';
  }
}

/** Delici bod mezi rukama: mezera v rozlozeni vysek nejbliz malemu c. */
export function odhadniDelicBod(udalosti: readonly Udalost[]): number {
  if (udalosti.length === 0) return 60;
  const vysky = udalosti.map((u) => u.midi).sort((a, b) => a - b);
  let nejlepsi = 60;
  let nejlepsiSkore = -Infinity;
  for (let kandidat = 48; kandidat <= 72; kandidat++) {
    let pod = 0;
    for (const v of vysky) if (v < kandidat) pod++;
    const vyvazenost = 1 - Math.abs(pod / vysky.length - 0.5) * 2;
    const blizkostKC1 = 1 - Math.abs(kandidat - 60) / 24;
    const skore = vyvazenost + blizkostKC1 * 0.5;
    if (skore > nejlepsiSkore) {
      nejlepsiSkore = skore;
      nejlepsi = kandidat;
    }
  }
  return nejlepsi;
}
