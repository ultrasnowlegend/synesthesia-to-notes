/** Ruka, ke ktere nota patri; urcuje osnovu ve vyslednem zapisu. */
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
  /**
   * Vyhradni rozsah, ktery s zadnou jinou klavesou nesdili. Cerna klavesa lezi
   * uvnitr sirky obou sousednich bilych, takze pruh bile klavesy by zabarvil i
   * sloupec cerne; vzorkuje se proto jen tenhle uzsi pruh.
   */
  vx1: number;
  vx2: number;
}

/**
 * Geometrie klaviatury odectena z jednoho snimku. Souradnice jsou v pixelech
 * puvodniho videa a plati pro jedno konkretni video: kamera je behem nej
 * staticka, ale mezi nahravkami se posouva, takze se geometrie nikdy nesdili.
 */
export interface GeometrieKlaviatury {
  sirkaObrazu: number;
  vyskaObrazu: number;
  /** Y horni hrany klaviatury. */
  hornihrana: number;
  /** Y dolni hrany klaviatury. */
  dolniHrana: number;
  /** Y radku, na kterem se vzorkuji bile klavesy (pod cernymi). */
  radekBilych: number;
  /** Y radku, na kterem se vzorkuji cerne klavesy. */
  radekCernych: number;
  /**
   * Y radku tesne pod horni hranou klaviatury. Hlavni signal: pruh pokracuje
   * pres klaviaturu a mizi, ale tady uz ma za sebou staticke klavesy misto
   * pohybliveho videa, takze je proti pozadi jednoznacny.
   */
  radekZare: number;
  /**
   * Y radku hloubeji v klaviature. Spolu s radkem zare dava rychlost padu:
   * oba lezi nad statickymi klavesami, takze jejich signal je cisty, kdezto
   * radky nad klaviaturou maji za sebou pohyblive video.
   */
  radekHloubky: number;
  /** Y radku tesne nad klaviaturou, nad zari dopadu. */
  radekDopadu: number;
  /** Y druheho radku vyse; z casoveho posunu mezi nimi vyjde rychlost padu. */
  radekVyssi: number;
  klavesy: Klavesa[];
}

/** Barva v RGB, slozky 0..255. */
export interface Barva {
  r: number;
  g: number;
  b: number;
}

/** Drahy obou rukou v case; x je v pixelech puvodniho videa, NaN = nenalezeno. */
export interface DrahyRukou {
  pocetSnimku: number;
  /** x[snimek * 2] = leva, x[snimek * 2 + 1] = prava. */
  x: Float32Array;
}

/** Surova udalost pred kvantizaci: nota drzena od-do v sekundach. */
export interface Udalost {
  midi: number;
  start: number;
  konec: number;
  ruka: Ruka;
  /** Prumerna barva pruhu; kdyz video ruce barvou rozlisuje, urcuje je. */
  barva: Barva;
  /** Jistota detekce 0..1. */
  jistota: number;
}

/** Nota po kvantizaci, pripravena k zapisu do notace. */
export interface Nota {
  midi: number;
  /** Zacatek v dobach od zacatku skladby. */
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
  /** MIDI cislo, pod kterym noty bez urcene ruky patri do basoveho klice. */
  delicBod: number;
}
