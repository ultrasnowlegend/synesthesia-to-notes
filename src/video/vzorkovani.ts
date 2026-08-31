import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { potrebneRadky, zonyRadku } from '../jadro/klaviatura.js';
import type { PasKlaviatury } from '../jadro/ruce.js';
import { zapisBarvu, type Stopa } from '../jadro/stopa.js';
import type { Barva, GeometrieKlaviatury } from '../jadro/typy.js';
import { ctiSyroveSnimky, type InfoVidea } from './ffmpeg.js';

export interface NastaveniVzorkovani {
  /** Sirka zmenseneho pasu klaviatury pro sledovani rukou. */
  sirkaPasu?: number;
  vyskaPasu?: number;
  /** Podil sirky klavesy, ktery se u obou okraju vynecha. */
  odsazeniKlavesy?: number;
}

const VYCHOZI = { sirkaPasu: 320, vyskaPasu: 24, odsazeniKlavesy: 0.18 } as const;

/**
 * Filtr, ktery z kazdeho snimku vyrizne jen potrebne radky a slozi je na sebe.
 * Diky tomu z ffmpegu vylezou misto 1080 radku jen jednotky, aniz bychom
 * museli poustet vic procesu nebo dekodovat video vickrat.
 */
function grafRadku(radky: readonly number[], vstup: string, vystup: string): string {
  if (radky.length === 1) return `[${vstup}]crop=iw:1:0:${radky[0]}[${vystup}]`;
  const casti: string[] = [];
  const jmena = radky.map((_, i) => `${vystup}s${i}`);
  casti.push(`[${vstup}]split=${radky.length}${jmena.map((j) => `[${j}]`).join('')}`);
  const orezane = radky.map((_, i) => `${vystup}c${i}`);
  radky.forEach((y, i) => casti.push(`[${jmena[i]}]crop=iw:1:0:${y}[${orezane[i]}]`));
  casti.push(`${orezane.map((o) => `[${o}]`).join('')}vstack=inputs=${radky.length}[${vystup}]`);
  return casti.join(';');
}

function prumerVOblasti(
  data: Uint8Array,
  sirka: number,
  radky: readonly number[],
  x1: number,
  x2: number,
): Barva {
  let r = 0;
  let g = 0;
  let b = 0;
  let pocet = 0;
  for (const y of radky) {
    const zacatek = y * sirka * 3;
    for (let x = x1; x <= x2; x++) {
      const i = zacatek + x * 3;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      pocet++;
    }
  }
  return pocet === 0 ? { r: 0, g: 0, b: 0 } : { r: r / pocet, g: g / pocet, b: b / pocet };
}

interface RostouciPole {
  data: Uint8Array;
  kapacitaSnimku: number;
}

function zvetsi(pole: RostouciPole, potrebaSnimku: number, bajtuNaSnimek: number): void {
  if (potrebaSnimku <= pole.kapacitaSnimku) return;
  const nova = Math.max(potrebaSnimku, Math.ceil(pole.kapacitaSnimku * 1.6) + 60);
  const vetsi = new Uint8Array(nova * bajtuNaSnimek);
  vetsi.set(pole.data);
  pole.data = vetsi;
  pole.kapacitaSnimku = nova;
}

export interface VysledekVzorkovani {
  stopa: Stopa;
  pas: PasKlaviatury;
}

/**
 * Jediny pruchod videem. Z jednoho dekodovani vzniknou obe veci, ktere dal
 * potrebujeme: barvy nad kazdou klavesou a zmenseny pas klaviatury pro
 * sledovani rukou.
 */
export async function postavStopu(
  video: string,
  info: InfoVidea,
  geometrie: GeometrieKlaviatury,
  nastaveni: NastaveniVzorkovani = {},
): Promise<VysledekVzorkovani> {
  const sirkaPasu = nastaveni.sirkaPasu ?? VYCHOZI.sirkaPasu;
  const vyskaPasu = nastaveni.vyskaPasu ?? VYCHOZI.vyskaPasu;
  const odsazeni = nastaveni.odsazeniKlavesy ?? VYCHOZI.odsazeniKlavesy;

  const radky = potrebneRadky(geometrie);
  const zony = zonyRadku(geometrie);
  const n = geometrie.klavesy.length;
  const bajtuNaSnimek = info.sirka * radky.length * 3;

  const rozsahy = geometrie.klavesy.map((k) => {
    const sirka = k.vx2 - k.vx1 + 1;
    const vynech = Math.min(Math.floor(sirka / 3), Math.max(1, Math.round(sirka * odsazeni)));
    return { x1: k.vx1 + vynech, x2: Math.max(k.vx1 + vynech, k.vx2 - vynech) };
  });

  const vyskaPasuVideo = Math.max(1, geometrie.dolniHrana - geometrie.hornihrana + 1);
  const souborPasu = join(tmpdir(), `syn2noty-pas-${randomBytes(6).toString('hex')}.raw`);

  // Prevod na rgb24 musi predchazet orezu: v yuv420p je barevna slozka
  // podvzorkovana na polovicni vysku, takze jednoradkovy orez z nej ffmpeg
  // odmitne jako nulovou vysku.
  const filtr = [
    `[0:v]fps=${info.fps.toFixed(6)},format=rgb24,split=2[radkyIn][pasIn]`,
    grafRadku(radky, 'radkyIn', 'radky'),
    `[pasIn]crop=iw:${vyskaPasuVideo}:0:${geometrie.hornihrana},scale=${sirkaPasu}:${vyskaPasu}:flags=area[pas]`,
  ].join(';');

  const odhad = Math.max(1, Math.ceil(info.delka * info.fps) + 30);
  const dopad: RostouciPole = { data: new Uint8Array(odhad * n * 3), kapacitaSnimku: odhad };
  const vyssi: RostouciPole = { data: new Uint8Array(odhad * n * 3), kapacitaSnimku: odhad };
  const klavesy: RostouciPole = { data: new Uint8Array(odhad * n * 3), kapacitaSnimku: odhad };

  const pocetSnimku = await ctiSyroveSnimky(
    [
      '-v', 'error',
      '-y',
      '-i', video,
      '-filter_complex', filtr,
      '-map', '[radky]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
      '-map', '[pas]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', souborPasu,
    ],
    bajtuNaSnimek,
    (data, index) => {
      zvetsi(dopad, index + 1, n * 3);
      zvetsi(vyssi, index + 1, n * 3);
      zvetsi(klavesy, index + 1, n * 3);
      for (let k = 0; k < n; k++) {
        const { x1, x2 } = rozsahy[k]!;
        zapisBarvu(dopad.data, index, k, n, prumerVOblasti(data, info.sirka, zony.dopad, x1, x2));
        zapisBarvu(vyssi.data, index, k, n, prumerVOblasti(data, info.sirka, zony.vyssi, x1, x2));
        const zonaTela = geometrie.klavesy[k]!.cerna ? zony.cerne : zony.bile;
        zapisBarvu(klavesy.data, index, k, n, prumerVOblasti(data, info.sirka, zonaTela, x1, x2));
      }
    },
  );

  const orez = (pole: RostouciPole): Uint8Array => pole.data.subarray(0, pocetSnimku * n * 3);
  const stopa: Stopa = {
    fps: info.fps,
    pocetSnimku,
    midi: geometrie.klavesy.map((k) => k.midi),
    dopad: orez(dopad),
    vyssi: orez(vyssi),
    klavesy: orez(klavesy),
  };

  const syrovyPas = await readFile(souborPasu);
  await rm(souborPasu, { force: true });
  const snimkuPasu = Math.floor(syrovyPas.length / (sirkaPasu * vyskaPasu * 3));
  const pas: PasKlaviatury = {
    sirka: sirkaPasu,
    vyska: vyskaPasu,
    pocetSnimku: Math.min(snimkuPasu, pocetSnimku),
    data: new Uint8Array(syrovyPas.buffer, syrovyPas.byteOffset, syrovyPas.length),
    posunX: 0,
    meritko: info.sirka / sirkaPasu,
  };

  return { stopa, pas };
}
