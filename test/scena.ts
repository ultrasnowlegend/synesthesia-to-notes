import { spawn } from 'node:child_process';

import type { Barva } from '../src/jadro/typy.js';

/**
 * Vykresluje umelou nahravku ve stylu, o ktery jde: skutecna klaviatura zakryta
 * rukama a nad ni padajici pruhy, ktere pod klaviaturou mizi. Dava nam znamou
 * pravdu, proti ktere jde cely retezec merit jeste driv, nez existuje ukazka
 * z realneho videa.
 */

const POLOTONY = [0, 2, 4, 5, 7, 9, 11] as const;
const NASLEDUJE_CERNA = [true, true, false, true, true, true, false] as const;

export interface TestNota {
  midi: number;
  /** Cas, kdy pruh dosedne na klaviaturu, v sekundach. */
  start: number;
  konec: number;
  ruka: 'leva' | 'prava';
}

export interface Scena {
  sirka: number;
  vyska: number;
  fps: number;
  delka: number;
  hornihrana: number;
  dolniHrana: number;
  /** MIDI cislo nejlevejsi bile klavesy. */
  prvniMidi: number;
  pocetBilych: number;
  /** Rychlost padu pruhu v pixelech za sekundu. */
  rychlost: number;
  /** Kdyz je false, oba pruhy maji stejnou barvu a ruce musi urcit sledovani. */
  barevneRuce: boolean;
  noty: TestNota[];
}

const POZADI: Barva = { r: 14, g: 16, b: 20 };
const BILA: Barva = { r: 242, g: 242, b: 240 };
const CERNA: Barva = { r: 20, g: 22, b: 26 };
const SPARA: Barva = { r: 120, g: 124, b: 130 };
const RUKA: Barva = { r: 108, g: 112, b: 120 };
const PRUH_PRAVA: Barva = { r: 232, g: 161, b: 60 };
const PRUH_LEVA: Barva = { r: 51, g: 183, b: 158 };

export interface KlavesaSceny {
  midi: number;
  cerna: boolean;
  x1: number;
  x2: number;
}

/** Rozlozeni klaves, ze ktereho scena kresli a proti kteremu se meri detekce. */
export function klavesySceny(s: Scena): KlavesaSceny[] {
  const sirkaBile = s.sirka / s.pocetBilych;
  const out: KlavesaSceny[] = [];
  const midiBile: number[] = [];

  for (let i = 0; i < s.pocetBilych; i++) {
    const trida = i % 7;
    const midi = s.prvniMidi + POLOTONY[trida]! + 12 * Math.floor(i / 7);
    midiBile.push(midi);
    out.push({
      midi,
      cerna: false,
      x1: Math.round(i * sirkaBile),
      x2: Math.round((i + 1) * sirkaBile) - 1,
    });
  }
  for (let i = 0; i < s.pocetBilych - 1; i++) {
    if (!NASLEDUJE_CERNA[i % 7]) continue;
    const stred = (i + 1) * sirkaBile;
    const sirka = sirkaBile * 0.58;
    out.push({
      midi: midiBile[i]! + 1,
      cerna: true,
      x1: Math.round(stred - sirka / 2),
      x2: Math.round(stred + sirka / 2) - 1,
    });
  }
  return out.sort((a, b) => a.midi - b.midi);
}

function obdelnik(
  data: Uint8Array,
  sirka: number,
  vyska: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  barva: Barva,
  kryti = 1,
): void {
  const odX = Math.max(0, Math.round(x1));
  const doX = Math.min(sirka - 1, Math.round(x2));
  const odY = Math.max(0, Math.round(y1));
  const doY = Math.min(vyska - 1, Math.round(y2));
  for (let y = odY; y <= doY; y++) {
    let i = (y * sirka + odX) * 3;
    for (let x = odX; x <= doX; x++) {
      data[i] = data[i]! + (barva.r - data[i]!) * kryti;
      data[i + 1] = data[i + 1]! + (barva.g - data[i + 1]!) * kryti;
      data[i + 2] = data[i + 2]! + (barva.b - data[i + 2]!) * kryti;
      i += 3;
    }
  }
}

/** Poloha ruky = stred posledni klavesy, kterou ta ruka hrala. */
function polohaRuky(s: Scena, klavesy: readonly KlavesaSceny[], ruka: 'leva' | 'prava', cas: number): number {
  const stredy = new Map(klavesy.map((k) => [k.midi, (k.x1 + k.x2) / 2]));
  let posledni = ruka === 'leva' ? s.sirka * 0.25 : s.sirka * 0.7;
  for (const n of s.noty) {
    if (n.ruka !== ruka || n.start > cas) continue;
    const stred = stredy.get(n.midi);
    if (stred !== undefined) posledni = stred;
  }
  // Mirny pohyb navic: staticka ruka by v medianu nezmizela.
  return posledni + Math.sin(cas * 1.7) * 12;
}

export function vykresliSnimek(s: Scena, cas: number): Uint8Array {
  const data = new Uint8Array(s.sirka * s.vyska * 3);
  obdelnik(data, s.sirka, s.vyska, 0, 0, s.sirka - 1, s.vyska - 1, POZADI);

  const klavesy = klavesySceny(s);
  const hraniceCerne = s.hornihrana + (s.dolniHrana - s.hornihrana) * 0.6;

  for (const k of klavesy) {
    if (k.cerna) continue;
    obdelnik(data, s.sirka, s.vyska, k.x1, s.hornihrana, k.x2, s.dolniHrana, BILA);
    obdelnik(data, s.sirka, s.vyska, k.x2 - 1, s.hornihrana, k.x2, s.dolniHrana, SPARA);
  }
  for (const k of klavesy) {
    if (!k.cerna) continue;
    obdelnik(data, s.sirka, s.vyska, k.x1, s.hornihrana, k.x2, hraniceCerne, CERNA);
  }

  // Pruhy padaji shora; spodni hrana dosedne na klaviaturu presne v case startu
  // a pak pokracuje pod ni, kde se orizne.
  for (const n of s.noty) {
    const k = klavesy.find((c) => c.midi === n.midi);
    if (!k) continue;
    const spodek = s.hornihrana + (cas - n.start) * s.rychlost;
    const vrsek = spodek - (n.konec - n.start) * s.rychlost;
    if (spodek < 0 || vrsek > s.hornihrana) continue;
    const barva = s.barevneRuce && n.ruka === 'leva' ? PRUH_LEVA : PRUH_PRAVA;
    // Pruh bile klavesy zabira jen jeji viditelnou sirku, tedy bez casti
    // zakryte sousednimi cernymi; tak to kresli i bezne prehravace.
    const vlevo = klavesy.find((c) => c.cerna && c.x2 >= k.x1 && c.x2 <= k.x2);
    const vpravo = klavesy.find((c) => c.cerna && c.x1 >= k.x1 && c.x1 <= k.x2);
    const odX = k.cerna || !vlevo ? k.x1 + 1 : vlevo.x2 + 1;
    const doX = k.cerna || !vpravo ? k.x2 - 1 : vpravo.x1 - 1;
    obdelnik(data, s.sirka, s.vyska, odX, vrsek, doX, Math.min(spodek, s.hornihrana - 1), barva);

    // Pruh se na klaviature nezastavi — pokracuje pres ni a mizi. Prave tenhle
    // presah pres staticke klavesy je hlavni signal detekce.
    const hloubka = (s.dolniHrana - s.hornihrana) * 0.55;
    if (spodek >= s.hornihrana) {
      obdelnik(
        data,
        s.sirka,
        s.vyska,
        odX,
        Math.max(vrsek, s.hornihrana),
        doX,
        Math.min(spodek, s.hornihrana + hloubka),
        barva,
        0.8,
      );
    }
  }

  for (const ruka of ['leva', 'prava'] as const) {
    const stred = polohaRuky(s, klavesy, ruka, cas);
    const sirkaRuky = s.sirka / s.pocetBilych * 3.4;
    obdelnik(
      data,
      s.sirka,
      s.vyska,
      stred - sirkaRuky / 2,
      s.hornihrana + (s.dolniHrana - s.hornihrana) * 0.35,
      stred + sirkaRuky / 2,
      s.dolniHrana - 4,
      RUKA,
    );
  }

  return data;
}

/** Zakoduje scenu do souboru mp4 pres ffmpeg. */
export function vytvorVideo(s: Scena, cesta: string): Promise<void> {
  const pocetSnimku = Math.round(s.delka * s.fps);
  return new Promise((splnit, odmitnout) => {
    const ffmpeg = spawn(
      process.env['FFMPEG_PATH'] ?? 'ffmpeg',
      [
        '-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', `${s.sirka}x${s.vyska}`, '-r', String(s.fps),
        '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
        '-pix_fmt', 'yuv420p',
        cesta,
      ],
      { windowsHide: true },
    );

    let chyby = '';
    ffmpeg.stderr.on('data', (d: Buffer) => (chyby += d.toString()));
    ffmpeg.on('error', odmitnout);
    ffmpeg.on('close', (kod) =>
      kod === 0 ? splnit() : odmitnout(new Error(`ffmpeg skoncil s ${kod}\n${chyby}`)),
    );

    let i = 0;
    const posilej = (): void => {
      while (i < pocetSnimku) {
        const snimek = Buffer.from(vykresliSnimek(s, i / s.fps));
        i++;
        if (!ffmpeg.stdin.write(snimek)) {
          ffmpeg.stdin.once('drain', posilej);
          return;
        }
      }
      ffmpeg.stdin.end();
    };
    posilej();
  });
}
