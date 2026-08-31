/** Ruka podle barvy pruhu ve videu; slouzi k rozdeleni do dvou osnov. */
export type Ruka = 'leva' | 'prava' | 'neznama';

/** Jedna klavesa nalezena v obraze, vcetne prirazene vysky tonu. */
export interface Klavesa {
  midi: number;
  cerna: boolean;
  /** Levy okraj v pixelech (vcetne). */
  x1: number;
  /** Pravy okraj v pixelech (vcetne). */
  x2: number;
  stred: number;
}

/**
 * Geometrie klaviatury odectena z jednoho snimku. Souradnice jsou v pixelech
 * puvodniho videa; vsechny dalsi kroky uz pracuji jen s timto popisem, nikdy
 * znovu s celym obrazem.
 */
export interface GeometrieKlaviatury {
  sirkaObrazu: number;
  vyskaObrazu: number;
  /** Y horni hrany klaviatury (zacatek cernych klaves). */
  hornihrana: number;
  /** Y dolni hrany klaviatury. */
  dolniHrana: number;
  /** Y radku, na kterem se vzorkuji bile klavesy (pod cernymi). */
  radekBilych: number;
  /** Y radku, na kterem se vzorkuji cerne klavesy. */
  radekCernych: number;
  /** Y radku tesne nad klaviaturou, kde dopadaji pruhy. */
  radekDopadu: number;
  klavesy: Klavesa[];
}

/** Barva v RGB, slozky 0..255. */
export interface Barva {
  r: number;
  g: number;
  b: number;
}

/** Stav jedne klavesy v jednom snimku. */
export interface VzorekKlavesy {
  rozsviceno: boolean;
  barva: Barva;
  /** Odchylka od klidove barvy, 0..1. Slouzi k ladeni prahu. */
  odchylka: number;
}

/** Jeden snimek prevedeny na stavy vsech klaves. */
export interface Snimek {
  index: number;
  cas: number;
  klavesy: VzorekKlavesy[];
}

/** Surova udalost pred kvantizaci: nota drzena od-do v sekundach. */
export interface Udalost {
  midi: number;
  start: number;
  konec: number;
  ruka: Ruka;
  /** Prumerna barva pruhu, podle ni se urcuje ruka. */
  barva: Barva;
  /** Jistota detekce 0..1 (podil snimku, kde byla klavesa jasne rozsvicena). */
  jistota: number;
}

/** Nota po kvantizaci, pripravena k zapisu do notace. */
export interface Nota {
  midi: number;
  /** Zacatek v dobach (quarter notes) od zacatku skladby. */
  doba: number;
  /** Delka v dobach. */
  delka: number;
  ruka: Ruka;
  hlasitost: number;
}

/** Vysledek odhadu tempa. */
export interface Tempo {
  bpm: number;
  /** Cas prvni doby v sekundach. */
  offset: number;
  /** Citatel/jmenovatel taktu. */
  citatel: number;
  jmenovatel: number;
  /** Jak dobre mrizka sedi na onsety, 0..1. */
  shoda: number;
}

/** Kompletni prepis jednoho videa. */
export interface Prepis {
  udalosti: Udalost[];
  tempo: Tempo;
  /** Pocet posunek: zaporne = bemoly, kladne = krizky. */
  predznamenani: number;
  /** MIDI cislo, pod kterym noty patri do basoveho klice (kdyz chybi barvy rukou). */
  delicBod: number;
}
