import {
  detekujUdalosti,
  odhadniDelicBod,
  rozdelPodleVysky,
  type NastaveniDetekce,
} from './jadro/detekce.js';
import type { NastaveniKlaviatury } from './jadro/klaviatura.js';
import { najdiOnsety } from './jadro/onsety.js';
import { prirazeniPodlePolohy, sledujRuce, type NastaveniRukou } from './jadro/ruce.js';
import { sladSeZvukem, upresniPodleZvuku, type Sladeni } from './jadro/sladeni.js';
import type { Stopa } from './jadro/stopa.js';
import {
  kvantizuj,
  odhadniTempo,
  zarovnejNaZacatek,
  type NastaveniTempa,
} from './jadro/tempo.js';
import { odhadniToninu, type Tonina } from './jadro/tonina.js';
import type { Obraz } from './jadro/obraz.js';
import type { DrahyRukou, GeometrieKlaviatury, Nota, Tempo, Udalost } from './jadro/typy.js';
import { nactiVzorky } from './audio/zvuk.js';
import { nactiInfo, type InfoVidea } from './video/ffmpeg.js';
import { zkalibruj } from './video/kalibrace.js';
import { postavStopu, type NastaveniVzorkovani } from './video/vzorkovani.js';

export interface NastaveniPrepisu {
  klaviatura?: NastaveniKlaviatury;
  vzorkovani?: NastaveniVzorkovani;
  detekce?: NastaveniDetekce;
  ruce?: NastaveniRukou;
  tempo?: NastaveniTempa;
  vzorkuKalibrace?: number;
  /** Vypnout pouziti zvuku; obraz pak funguje sam, jen s presnosti snimku. */
  bezZvuku?: boolean;
  /** Nepovinne hlaseni prubehu; CLI i aplikace si ho vykresli po svem. */
  naStav?: (zprava: string) => void;
}

export interface VysledekPrepisu {
  info: InfoVidea;
  geometrie: GeometrieKlaviatury;
  /** Klidovy snimek, ze ktereho geometrie vznikla; slouzi ke kontrole kalibrace. */
  pozadi: Obraz;
  stopa: Stopa;
  drahy: DrahyRukou;
  udalosti: Udalost[];
  noty: Nota[];
  tempo: Tempo;
  tonina: Tonina;
  delicBod: number;
  /** Rychlost padu pruhu v px/snimek; NaN, kdyz se nepodarilo zmerit. */
  rychlostPadu: number;
  /** Prah, na kterem detekce nakonec bezela. */
  prah: number;
  /** Shoda se zvukem; presnost je zaroven mira duvery v cely prepis. */
  sladeni: Sladeni;
}

/**
 * Cely prevod jednoho videa. Poradi kroku je pevne dane a kazdy z nich pracuje
 * jen s vysledkem toho predchoziho, takze jde kterykoli z nich vymenit nebo
 * spustit znovu s jinym nastavenim bez opakovaneho dekodovani videa.
 */
export async function prepisVideo(
  video: string,
  nastaveni: NastaveniPrepisu = {},
): Promise<VysledekPrepisu> {
  const hlas = nastaveni.naStav ?? ((): void => {});

  hlas('ctu metadata videa');
  const info = await nactiInfo(video);

  hlas(`kalibruji klaviaturu (${info.sirka}x${info.vyska}, ${info.fps.toFixed(2)} fps)`);
  const kalibrace = await zkalibruj(
    video,
    info,
    nastaveni.klaviatura ?? {},
    nastaveni.vzorkuKalibrace ?? 40,
  );
  const geometrie = kalibrace.geometrie;
  const pozadi = kalibrace.pozadi;
  hlas(`nalezeno ${geometrie.klavesy.length} klaves, rozsah MIDI ${geometrie.klavesy[0]?.midi}-${geometrie.klavesy[geometrie.klavesy.length - 1]?.midi}`);

  hlas('ctu video');
  const { stopa, pas } = await postavStopu(video, info, geometrie, nastaveni.vzorkovani ?? {});
  hlas(`zpracovano ${stopa.pocetSnimku} snimku`);

  hlas('hledam noty');
  const detekce = detekujUdalosti(stopa, geometrie, nastaveni.detekce ?? {});
  const udalosti = detekce.udalosti;
  hlas(`nalezeno ${udalosti.length} not`);

  hlas('sleduji ruce');
  const drahy = sledujRuce(pas, nastaveni.ruce ?? {});
  prirazeniPodlePolohy(udalosti, drahy, geometrie, stopa.fps);

  const delicBod = odhadniDelicBod(udalosti);
  rozdelPodleVysky(udalosti, delicBod);

  let sladeni: Sladeni = { posun: 0, presnost: 0, pokryti: 0 };
  if (!nastaveni.bezZvuku) {
    hlas('porovnavam se zvukem');
    try {
      const udery = najdiOnsety(await nactiVzorky(video));
      sladeni = sladSeZvukem(udalosti, udery);
      if (sladeni.presnost > 0.5) {
        upresniPodleZvuku(udalosti, udery, sladeni.posun);
        udalosti.sort((a, b) => a.start - b.start || a.midi - b.midi);
      }
      hlas(
        `zvuk: ${udery.length} uderu, posun ${Math.round(sladeni.posun * 1000)} ms, ` +
          `shoda ${Math.round(sladeni.presnost * 100)} %`,
      );
    } catch (e) {
      hlas(`zvuk se nepodarilo zpracovat (${(e as Error).message}); pokracuji bez nej`);
    }
  }

  hlas('odhaduji tempo');
  const tempo = odhadniTempo(udalosti, nastaveni.tempo ?? {});
  const noty = kvantizuj(udalosti, tempo, nastaveni.tempo ?? {});
  zarovnejNaZacatek(noty);
  const tonina = odhadniToninu(noty);
  hlas(`tempo ${tempo.bpm} BPM (shoda ${tempo.shoda.toFixed(2)}), predznamenani ${tonina.kvinty}`);

  return {
    info,
    geometrie,
    pozadi,
    stopa,
    drahy,
    udalosti,
    noty,
    tempo,
    tonina,
    delicBod,
    rychlostPadu: detekce.rychlostPadu,
    prah: detekce.prah,
    sladeni,
  };
}
