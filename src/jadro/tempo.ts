import type { Nota, Tempo, Udalost } from './typy.js';

export interface NastaveniTempa {
  /** Pevne BPM; kdyz chybi, odhadne se z onsetu. */
  bpm?: number;
  /** Pevny cas prvni doby v sekundach. */
  offset?: number;
  citatel?: number;
  jmenovatel?: number;
  /** Nejmensi delena doba: 4 = sestnactiny, 2 = osminy, 6 = osminove trioly. */
  deleni?: number;
  /** Prohledavany rozsah temp. */
  minBpm?: number;
  maxBpm?: number;
}

/** Starty not, ktere spadaji do sebe, jsou jeden akord a pro tempo jeden onset. */
export function onsety(udalosti: readonly Udalost[], tolerance = 0.05): number[] {
  const starty = udalosti.map((u) => u.start).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of starty) {
    const posledni = out[out.length - 1];
    if (posledni === undefined || t - posledni > tolerance) out.push(t);
  }
  return out;
}

/**
 * Sila mrizky s danou periodou: soucet jednotkovych vektoru fazi vsech onsetu.
 * Kdyz onsety na mrizku sedi, faze se sectou; kdyz ne, vzajemne se vyrusi.
 * Uhel vysledku rovnou dava i nejlepsi posun mrizky.
 */
function hrebenovyFiltr(onsety: readonly number[], perioda: number): { sila: number; faze: number } {
  let cos = 0;
  let sin = 0;
  for (const t of onsety) {
    const uhel = (2 * Math.PI * t) / perioda;
    cos += Math.cos(uhel);
    sin += Math.sin(uhel);
  }
  const n = Math.max(1, onsety.length);
  const sila = Math.hypot(cos, sin) / n;
  let faze = Math.atan2(sin, cos) / (2 * Math.PI);
  if (faze < 0) faze += 1;
  return { sila, faze };
}

/**
 * Vaha upresnujici tempo k obvyklemu rozsahu. Bez ni hrebenovy filtr skoro vzdy
 * vyhraje na dvojnasobku nebo polovine spravneho tempa, protoze i tam onsety sedi.
 */
function prioritaTempa(bpm: number): number {
  const log = Math.log2(bpm / 110);
  return Math.exp(-(log * log) / (2 * 0.55 * 0.55));
}

export function odhadniTempo(udalosti: readonly Udalost[], nastaveni: NastaveniTempa = {}): Tempo {
  const citatel = nastaveni.citatel ?? 4;
  const jmenovatel = nastaveni.jmenovatel ?? 4;
  const ons = onsety(udalosti);

  if (nastaveni.bpm !== undefined) {
    const perioda = 60 / nastaveni.bpm;
    const f = hrebenovyFiltr(ons, perioda);
    return {
      bpm: nastaveni.bpm,
      offset: nastaveni.offset ?? (ons[0] ?? 0) - Math.floor((ons[0] ?? 0) / perioda) * perioda,
      citatel,
      jmenovatel,
      shoda: f.sila,
    };
  }

  if (ons.length < 4) {
    return { bpm: 100, offset: ons[0] ?? 0, citatel, jmenovatel, shoda: 0 };
  }

  const minBpm = nastaveni.minBpm ?? 45;
  const maxBpm = nastaveni.maxBpm ?? 200;
  let nejlepsi = { bpm: 100, faze: 0, sila: 0, skore: -1 };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const perioda = 60 / bpm;
    const f = hrebenovyFiltr(ons, perioda);
    const skore = f.sila * prioritaTempa(bpm);
    if (skore > nejlepsi.skore) nejlepsi = { bpm, faze: f.faze, sila: f.sila, skore };
  }

  const perioda = 60 / nejlepsi.bpm;
  // Faze udava, kde lezi mrizka; prevedeme ji na cas prvni doby pred prvnim onsetem.
  let offset = nejlepsi.faze * perioda;
  const prvni = ons[0]!;
  while (offset > prvni + perioda / 2) offset -= perioda;
  while (offset < prvni - perioda / 2) offset += perioda;

  return {
    bpm: nastaveni.bpm ?? Math.round(nejlepsi.bpm * 4) / 4,
    offset: nastaveni.offset ?? offset,
    citatel,
    jmenovatel,
    shoda: nejlepsi.sila,
  };
}

/** Prevede sekundy na doby podle odhadnuteho tempa. */
export function naDoby(cas: number, tempo: Tempo): number {
  return ((cas - tempo.offset) * tempo.bpm) / 60;
}

/**
 * Prichyti udalosti na rytmickou mrizku. Delka se zaokrouhluje zvlast od zacatku,
 * aby se chyba nescitala; nota nikdy nezkratne pod jeden dilek mrizky.
 */
export function kvantizuj(
  udalosti: readonly Udalost[],
  tempo: Tempo,
  nastaveni: NastaveniTempa = {},
): Nota[] {
  const deleni = nastaveni.deleni ?? 4;
  const dilek = 1 / deleni;
  const naMrizku = (doba: number): number => Math.round(doba / dilek) * dilek;

  const noty: Nota[] = [];
  for (const u of udalosti) {
    const start = naMrizku(naDoby(u.start, tempo));
    let konec = naMrizku(naDoby(u.konec, tempo));
    if (konec <= start) konec = start + dilek;
    noty.push({
      midi: u.midi,
      doba: start,
      delka: konec - start,
      ruka: u.ruka,
      hlasitost: Math.max(40, Math.min(110, Math.round(50 + u.jistota * 50))),
    });
  }

  noty.sort((a, b) => a.doba - b.doba || a.midi - b.midi);
  return odstranPrekryv(noty);
}

/** Dve noty stejne vysky se nesmi prekryvat; kratsi z nich ustoupi. */
function odstranPrekryv(noty: Nota[]): Nota[] {
  const podleVysky = new Map<number, Nota[]>();
  for (const n of noty) {
    const seznam = podleVysky.get(n.midi);
    if (seznam) seznam.push(n);
    else podleVysky.set(n.midi, [n]);
  }
  const out: Nota[] = [];
  for (const seznam of podleVysky.values()) {
    seznam.sort((a, b) => a.doba - b.doba);
    for (let i = 0; i < seznam.length; i++) {
      const n = seznam[i]!;
      const dalsi = seznam[i + 1];
      if (dalsi && n.doba + n.delka > dalsi.doba) n.delka = dalsi.doba - n.doba;
      if (n.delka > 0) out.push(n);
    }
  }
  out.sort((a, b) => a.doba - b.doba || a.midi - b.midi);
  return out;
}

/** Posune skladbu tak, aby prvni nota zacinala na prvni dobe prvniho taktu. */
export function zarovnejNaZacatek(noty: Nota[]): void {
  const prvni = noty[0];
  if (!prvni || prvni.doba === 0) return;
  const posun = prvni.doba;
  for (const n of noty) n.doba -= posun;
}
