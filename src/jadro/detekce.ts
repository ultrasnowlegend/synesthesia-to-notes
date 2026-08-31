import { medianBarev, odstin, sytost, vzdalenostBarev } from './barvy.js';
import { otsu } from './obraz.js';
import { barva, type Stopa, type Vrstva } from './stopa.js';
import type { Barva, GeometrieKlaviatury, Ruka, Udalost } from './typy.js';

export interface NastaveniDetekce {
  /** Prah odchylky od klidove barvy, 0..1. Kdyz chybi, urci se z dat. */
  prah?: number;
  /** Kratsi zablesky nez tolik snimku zahazujeme jako sum. */
  minSnimku?: number;
  /** Mezery kratsi nez tolik snimku spojujeme; vznikaji vyhlazovanim hran. */
  spojMezeruSnimku?: number;
  /** Posunout casy o dobu, kterou pruh potrebuje z radku dopadu ke klavesam. */
  korigujZpozdeni?: boolean;
  /** Priradit ruce podle odstinu pruhu, kdyz je video rozlisuje. */
  ruceZBarvy?: boolean;
}

const VYCHOZI = {
  minSnimku: 2,
  spojMezeruSnimku: 1,
  korigujZpozdeni: true,
  ruceZBarvy: true,
} as const;

/**
 * Klidova barva kazdeho sloupce = median pres cele video. Pruh kryje dane misto
 * jen zlomek casu, takze median ukaze pozadi i u hustych pasazi; hledat snimek
 * s tichem neni potreba.
 */
export function klidoveBarvy(stopa: Stopa, vrstva: Vrstva, vzorku = 400): Barva[] {
  const n = stopa.midi.length;
  const krok = Math.max(1, Math.floor(stopa.pocetSnimku / vzorku));
  const out: Barva[] = [];
  for (let k = 0; k < n; k++) {
    const vzorky: Barva[] = [];
    for (let f = 0; f < stopa.pocetSnimku; f += krok) vzorky.push(barva(stopa, vrstva, f, k));
    out.push(medianBarev(vzorky));
  }
  return out;
}

/** Odchylka kazdeho sloupce od jeho klidove barvy, snimek po snimku. */
export function odchylky(stopa: Stopa, vrstva: Vrstva, klid: readonly Barva[]): Float32Array {
  const n = stopa.midi.length;
  const out = new Float32Array(stopa.pocetSnimku * n);
  for (let f = 0; f < stopa.pocetSnimku; f++) {
    for (let k = 0; k < n; k++) {
      out[f * n + k] = vzdalenostBarev(barva(stopa, vrstva, f, k), klid[k]!);
    }
  }
  return out;
}

/**
 * Prah mezi "prazdno" a "pruh" hleda Otsu nad rozdelenim vsech odchylek. Rucni
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

/** Souvisle useky, kde je sloupec zakryty pruhem, s vyhlazenim mezer a zablesku. */
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
 * Rychlost padu pruhu v pixelech za snimek. Tyz pruh mine horni radek driv nez
 * spodni, takze staci najit posun, pri kterem se oba signaly nejlepe kryji.
 *
 * Porovnavaji se jen nabezne hrany, ne cele doby zakryti: dlouhy pruh kryje
 * radek desitky snimku a korelace celych useku by mela plocho maximum, ze
 * ktereho by posun nesel odectit. Hrany jsou ostre a maximum je jednoznacne.
 *
 * Vraci NaN, kdyz zadny posun zretelne nevyhraje.
 */
export function zmerRychlostPadu(
  stopa: Stopa,
  geometrie: GeometrieKlaviatury,
  prah: number,
  klidDopadu: readonly Barva[],
  klidVyssi: readonly Barva[],
  maxPosun = 90,
): number {
  const n = stopa.midi.length;
  const rozestup = geometrie.radekDopadu - geometrie.radekVyssi;
  if (rozestup <= 0) return NaN;

  const nastupy = (vrstva: 'vyssi' | 'dopad', klid: readonly Barva[]): Uint8Array => {
    const out = new Uint8Array(stopa.pocetSnimku * n);
    const predchozi = new Uint8Array(n);
    for (let f = 0; f < stopa.pocetSnimku; f++) {
      for (let k = 0; k < n; k++) {
        const kryto = vzdalenostBarev(barva(stopa, vrstva, f, k), klid[k]!) > prah ? 1 : 0;
        out[f * n + k] = kryto === 1 && predchozi[k] === 0 ? 1 : 0;
        predchozi[k] = kryto;
      }
    }
    return out;
  };

  const nastupVyssi = nastupy('vyssi', klidVyssi);
  const nastupDopad = nastupy('dopad', klidDopadu);

  let nejlepsiPosun = -1;
  let nejlepsiSkore = 0;
  let druheSkore = 0;
  for (let posun = 1; posun <= maxPosun; posun++) {
    let shoda = 0;
    for (let f = 0; f + posun < stopa.pocetSnimku; f++) {
      const a = f * n;
      const b = (f + posun) * n;
      for (let k = 0; k < n; k++) {
        if (nastupVyssi[a + k] === 1 && nastupDopad[b + k] === 1) shoda++;
      }
    }
    if (shoda > nejlepsiSkore) {
      druheSkore = nejlepsiSkore;
      nejlepsiSkore = shoda;
      nejlepsiPosun = posun;
    } else if (shoda > druheSkore) {
      druheSkore = shoda;
    }
  }

  // Bez zretelneho vitezstvi je vysledek jen nejvyssi sum; radeji nic nevracet.
  if (nejlepsiPosun < 1 || nejlepsiSkore < 6 || nejlepsiSkore < druheSkore * 1.3) return NaN;
  return rozestup / nejlepsiPosun;
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
 * Rozdeli barvy pruhu na dva shluky odstinu. Kdyz vyjdou blizko sebe, video ruce
 * barvou nerozlisuje a vraci se null; rozdeleni pak musi udelat sledovani rukou.
 */
export function shlukyRukou(
  vzorky: readonly { odstin: number; midi: number }[],
): { levy: number; pravy: number } | null {
  if (vzorky.length < 20) return null;

  const serazene = [...vzorky].sort((x, y) => x.odstin - y.odstin);
  let stredA = serazene[Math.floor(serazene.length * 0.15)]!.odstin;
  let stredB = serazene[Math.floor(serazene.length * 0.85)]!.odstin;
  let a: Shluk = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };
  let b: Shluk = { cos: 0, sin: 0, soucetMidi: 0, pocet: 0 };

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

  if (Math.abs(((stredA - stredB + 540) % 360) - 180) < 25) return null;
  return a.soucetMidi / a.pocet <= b.soucetMidi / b.pocet
    ? { levy: stredA, pravy: stredB }
    : { levy: stredB, pravy: stredA };
}

export interface VysledekDetekce {
  udalosti: Udalost[];
  prah: number;
  /** Rychlost padu pruhu v px/snimek; NaN, kdyz se nepodarilo zmerit. */
  rychlostPadu: number;
  /** O kolik sekund byly casy posunuty kvuli odstupu radku dopadu od klaves. */
  zpozdeni: number;
  odstinyRukou: { levy: number; pravy: number } | null;
}

/**
 * Prevede casovou stopu na seznam not. Hlavnim signalem je radek tesne nad
 * klaviaturou: pruh jim projde a doba, po kterou jej kryje, je delka noty.
 * Dva po sobe jdouci tony se tim oddeli samy, protoze mezi pruhy je vzdy mezera.
 */
export function detekujUdalosti(
  stopa: Stopa,
  geometrie: GeometrieKlaviatury,
  nastaveni: NastaveniDetekce = {},
): VysledekDetekce {
  const n = stopa.midi.length;
  const minSnimku = nastaveni.minSnimku ?? VYCHOZI.minSnimku;
  const spojMezeru = nastaveni.spojMezeruSnimku ?? VYCHOZI.spojMezeruSnimku;

  const klidDopadu = klidoveBarvy(stopa, 'dopad');
  const odch = odchylky(stopa, 'dopad', klidDopadu);
  const prah = nastaveni.prah ?? odhadniPrah(odch);
  const sviti = (f: number, k: number): boolean => odch[f * n + k]! > prah;

  const klidVyssi = klidoveBarvy(stopa, 'vyssi');
  const rychlostPadu = zmerRychlostPadu(stopa, geometrie, prah, klidDopadu, klidVyssi);

  // Pruh mine radek dopadu driv, nez dosedne na klavesy, takze detekovany cas
  // predbiha skutecny uder. Posun je konstantni a nemeni delky, jen zacatky.
  const odstup = geometrie.hornihrana - geometrie.radekDopadu;
  const zpozdeni =
    (nastaveni.korigujZpozdeni ?? VYCHOZI.korigujZpozdeni) && Number.isFinite(rychlostPadu)
      ? odstup / rychlostPadu / stopa.fps
      : 0;

  const nalezene = behy(sviti, stopa.pocetSnimku, n, minSnimku, spojMezeru);

  const popis = nalezene.map((b) => {
    const barvy: Barva[] = [];
    let soucet = 0;
    for (let f = b.od; f <= b.do; f++) {
      barvy.push(barva(stopa, 'dopad', f, b.klavesa));
      soucet += odch[f * n + b.klavesa]!;
    }
    const delka = b.do - b.od + 1;
    return {
      beh: b,
      barva: medianBarev(barvy),
      jistota: Math.min(1, soucet / delka / Math.max(prah, 1e-6) / 3),
    };
  });

  let odstinyRukou: { levy: number; pravy: number } | null = null;
  if (nastaveni.ruceZBarvy ?? VYCHOZI.ruceZBarvy) {
    odstinyRukou = shlukyRukou(
      popis
        .filter((p) => sytost(p.barva) > 0.25)
        .map((p) => ({ odstin: odstin(p.barva), midi: stopa.midi[p.beh.klavesa]! })),
    );
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
      start: p.beh.od / stopa.fps + zpozdeni,
      konec: (p.beh.do + 1) / stopa.fps + zpozdeni,
      ruka,
      barva: p.barva,
      jistota: p.jistota,
    };
  });

  udalosti.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { udalosti, prah, rychlostPadu, zpozdeni, odstinyRukou };
}

/** Zaloha, kdyz nelze urcit ruku ani barvou, ani polohou: deli se podle vysky. */
export function rozdelPodleVysky(udalosti: Udalost[], delicBod: number): void {
  for (const u of udalosti) {
    if (u.ruka === 'neznama') u.ruka = u.midi < delicBod ? 'leva' : 'prava';
  }
}

/** Delici bod mezi rukama: vyska, ktera rozdeli noty co nejvyrovnaneji u c1. */
export function odhadniDelicBod(udalosti: readonly Udalost[]): number {
  if (udalosti.length === 0) return 60;
  const vysky = udalosti.map((u) => u.midi);
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
