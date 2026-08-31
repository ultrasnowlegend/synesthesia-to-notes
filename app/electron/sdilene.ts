import type { NastaveniDetekce } from '../../src/jadro/detekce.js';
import type { NastaveniKlaviatury } from '../../src/jadro/klaviatura.js';
import type { Sladeni } from '../../src/jadro/sladeni.js';
import type { NastaveniTempa } from '../../src/jadro/tempo.js';
import type { Tempo } from '../../src/jadro/typy.js';

/**
 * Odpoved z hlavniho procesu. Neni to rozlisovana unie: `data` zustava
 * nepovinne i kdyz `ok` plati, takze na strane okna vzdy pouzij `?? nahradu`.
 */
export interface Odpoved<T> {
  ok: boolean;
  data?: T;
  chyba?: string;
}

/** Vse, co jde menit bez opakovaneho cteni videa. */
export interface NastaveniMrizky extends NastaveniTempa {
  /** Nejdelsi mezera v dobach, kterou vyplni prodlouzeny ton misto pomlky. */
  legato?: number;
}

/** Vse, co si okno o prepisu potrebuje pamatovat. */
export interface Souhrn {
  video: string;
  delka: number;
  fps: number;
  snimku: number;
  klaves: number;
  rozsah: [number, number];
  udalosti: number;
  noty: number;
  tempo: Tempo;
  kvinty: number;
  tonina: string;
  prah: number;
  sladeni: Sladeni;
  hornihrana: number;
  dolniHrana: number;
  prvniMidi: number;
  levouRukou: number;
  /** Klidovy snimek s vyznacenymi klavesami; datova URL. */
  nahledKalibrace: string;
  /** Nalezene noty jako klavirni rolka; datova URL. */
  nahledRolky: string;
  stran: number;
}

export interface NastaveniPrepisuOkna {
  klaviatura?: NastaveniKlaviatury;
  detekce?: NastaveniDetekce;
}

export interface MostAplikace {
  vyberVideo: () => Promise<Odpoved<string | null>>;
  prepis: (
    cesta: string,
    nastaveni: NastaveniPrepisuOkna & NastaveniMrizky,
  ) => Promise<Odpoved<Souhrn>>;
  prekvantuj: (nastaveni: NastaveniMrizky) => Promise<Odpoved<Souhrn>>;
  strana: (cislo: number) => Promise<Odpoved<string>>;
  export: (typ: 'midi' | 'musicxml' | 'pdf') => Promise<Odpoved<string | null>>;
  otevriSlozku: (cesta: string) => Promise<Odpoved<void>>;
  /** Cesta pretazeneho souboru; File.path uz novy Electron nenabizi. */
  cestaSouboru: (soubor: File) => string;
  naStav: (posluchac: (zprava: string) => void) => () => void;
}
