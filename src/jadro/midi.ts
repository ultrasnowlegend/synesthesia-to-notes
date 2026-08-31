import type { Nota, Tempo } from './typy.js';

const TIKY_NA_DOBU = 480;

function varlen(hodnota: number): number[] {
  const out = [hodnota & 0x7f];
  let v = hodnota >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

function u32(hodnota: number): number[] {
  return [(hodnota >> 24) & 0xff, (hodnota >> 16) & 0xff, (hodnota >> 8) & 0xff, hodnota & 0xff];
}

function u16(hodnota: number): number[] {
  return [(hodnota >> 8) & 0xff, hodnota & 0xff];
}

function stopa(udalosti: readonly number[][]): number[] {
  const telo = udalosti.flat();
  telo.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(telo.length), ...telo];
}

interface CasovaUdalost {
  tik: number;
  /** Nizsi jde driv pri shodnem case; note-off musi predchazet note-on. */
  poradi: number;
  bajty: number[];
}

function serad(udalosti: CasovaUdalost[]): number[][] {
  udalosti.sort((a, b) => a.tik - b.tik || a.poradi - b.poradi);
  let posledni = 0;
  return udalosti.map((u) => {
    const delta = u.tik - posledni;
    posledni = u.tik;
    return [...varlen(delta), ...u.bajty];
  });
}

export interface NastaveniMidi {
  /** Jmeno skladby zapsane do metadat. */
  nazev?: string;
}

/**
 * Zapise noty jako standardni MIDI soubor typu 1: prvni stopa nese tempo a takt,
 * dalsi dve odpovidaji rukam. Vlastni zapis je tu proto, ze format je jednoduchy
 * a jadro tak zustava bez zavislosti.
 */
export function zapisMidi(
  noty: readonly Nota[],
  tempo: Tempo,
  kvinty: number,
  nastaveni: NastaveniMidi = {},
): Uint8Array {
  const hlavicka = [
    0x4d, 0x54, 0x68, 0x64,
    ...u32(6),
    ...u16(1),
    ...u16(3),
    ...u16(TIKY_NA_DOBU),
  ];

  const mikrosekundNaDobu = Math.round(60_000_000 / tempo.bpm);
  const rizeni: number[][] = [];
  if (nastaveni.nazev) {
    const jmeno = [...new TextEncoder().encode(nastaveni.nazev)];
    rizeni.push([0x00, 0xff, 0x03, ...varlen(jmeno.length), ...jmeno]);
  }
  rizeni.push([
    0x00, 0xff, 0x51, 0x03,
    (mikrosekundNaDobu >> 16) & 0xff,
    (mikrosekundNaDobu >> 8) & 0xff,
    mikrosekundNaDobu & 0xff,
  ]);
  rizeni.push([
    0x00, 0xff, 0x58, 0x04,
    tempo.citatel,
    Math.round(Math.log2(tempo.jmenovatel)),
    24,
    8,
  ]);
  rizeni.push([0x00, 0xff, 0x59, 0x02, kvinty & 0xff, 0x00]);

  const stopy = [stopa(rizeni)];
  for (const [kanal, ruka] of [
    [0, 'prava'],
    [1, 'leva'],
  ] as const) {
    const vybrane = noty.filter((n) => (ruka === 'prava' ? n.ruka !== 'leva' : n.ruka === 'leva'));
    const udalosti: CasovaUdalost[] = [];
    udalosti.push({ tik: 0, poradi: 0, bajty: [0xc0 | kanal, 0] });
    for (const n of vybrane) {
      const zacatek = Math.round(n.doba * TIKY_NA_DOBU);
      const konec = Math.max(zacatek + 1, Math.round((n.doba + n.delka) * TIKY_NA_DOBU));
      udalosti.push({ tik: zacatek, poradi: 2, bajty: [0x90 | kanal, n.midi & 0x7f, n.hlasitost & 0x7f] });
      udalosti.push({ tik: konec, poradi: 1, bajty: [0x80 | kanal, n.midi & 0x7f, 0x40] });
    }
    stopy.push(stopa(serad(udalosti)));
  }

  return Uint8Array.from([...hlavicka, ...stopy.flat()]);
}
