import { najdiKlaviaturu, type NastaveniKlaviatury } from '../jadro/klaviatura.js';
import { medianSnimku, type Obraz } from '../jadro/obraz.js';
import type { GeometrieKlaviatury } from '../jadro/typy.js';
import { ctiSyroveSnimky, type InfoVidea } from './ffmpeg.js';

/**
 * Nacte jeden snimek z daneho casu. Hledani pred -i je rychle, protoze ffmpeg
 * skoci na nejblizsi klicovy snimek misto dekodovani od zacatku.
 */
async function snimekVCase(video: string, cas: number, info: InfoVidea): Promise<Obraz | null> {
  let vysledek: Uint8Array | null = null;
  await ctiSyroveSnimky(
    [
      '-v', 'error',
      '-ss', cas.toFixed(3),
      '-i', video,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    info.sirka * info.vyska * 3,
    (data) => {
      if (!vysledek) vysledek = Uint8Array.from(data);
    },
  );
  return vysledek ? { sirka: info.sirka, vyska: info.vyska, data: vysledek } : null;
}

export interface VysledekKalibrace {
  geometrie: GeometrieKlaviatury;
  /** Klidovy snimek, ze ktereho geometrie vznikla; hodi se do nahledu. */
  pozadi: Obraz;
  pouziteCasy: number[];
}

/**
 * Odecte geometrii klaviatury z mediánu nekolika desitek snimku rozprostrenych
 * po cele delce videa. Ruce jsou v kazdem snimku jinde, klaviatura ne, takze
 * median ukaze holou klaviaturu i u skutecneho klaviru.
 *
 * Kalibrace plati pro jedno video: kamera je behem nej staticka, ale mezi
 * nahravkami se posouva, takze se vysledek nikdy nepouziva znovu.
 */
export async function zkalibruj(
  video: string,
  info: InfoVidea,
  nastaveni: NastaveniKlaviatury = {},
  pocetVzorku = 40,
): Promise<VysledekKalibrace> {
  const delka = info.delka > 0 ? info.delka : 1;
  const casy: number[] = [];
  for (let i = 0; i < pocetVzorku; i++) {
    casy.push((delka * (i + 0.5)) / pocetVzorku);
  }

  const snimky: Obraz[] = [];
  const pouziteCasy: number[] = [];
  for (const cas of casy) {
    const s = await snimekVCase(video, cas, info);
    if (s) {
      snimky.push(s);
      pouziteCasy.push(cas);
    }
  }
  if (snimky.length === 0) throw new Error(`Z videa ${video} se nepodarilo nacist zadny snimek.`);

  const pozadi = medianSnimku(snimky);
  return { geometrie: najdiKlaviaturu(pozadi, nastaveni), pozadi, pouziteCasy };
}
