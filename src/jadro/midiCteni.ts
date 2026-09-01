/**
 * Cteni standardniho MIDI souboru. Nepotrebuje ho vlastni prevod z videa —
 * je tu proto, aby slo prepis zmerit proti referenci, kdyz k videu existuje
 * puvodni MIDI. Bez toho je jedinou kontrolou shoda se zvukem, ktera rika
 * jen *kdy* se hralo, ne *co*.
 */

export interface NotaZMidi {
  midi: number;
  /** Sekundy od zacatku souboru. */
  start: number;
  konec: number;
  hlasitost: number;
  stopa: number;
  kanal: number;
}

export interface ObsahMidi {
  noty: NotaZMidi[];
  /** Prvni nalezene tempo v BPM. */
  bpm: number;
  stop: number;
}

class Ctecka {
  private pozice = 0;

  constructor(private readonly data: Uint8Array) {}

  get konec(): boolean {
    return this.pozice >= this.data.length;
  }

  get kde(): number {
    return this.pozice;
  }

  bajt(): number {
    const b = this.data[this.pozice];
    if (b === undefined) throw new Error('MIDI soubor konci uprostred udalosti.');
    this.pozice++;
    return b;
  }

  nahled(): number {
    return this.data[this.pozice] ?? 0;
  }

  cislo(delka: number): number {
    let v = 0;
    for (let i = 0; i < delka; i++) v = (v << 8) | this.bajt();
    return v >>> 0;
  }

  /** Delka s promennym poctem bajtu; nejvyssi bit znaci pokracovani. */
  varlen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.bajt();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return v;
  }

  preskoc(delka: number): void {
    this.pozice += delka;
  }

  znacka(): string {
    return String.fromCharCode(this.bajt(), this.bajt(), this.bajt(), this.bajt());
  }
}

interface SurovaUdalost {
  tik: number;
  stopa: number;
  typ: 'on' | 'off' | 'tempo';
  midi: number;
  kanal: number;
  hlasitost: number;
  /** Mikrosekundy na dobu u zmeny tempa. */
  tempo: number;
}

function ctiStopu(c: Ctecka, cisloStopy: number, delka: number): SurovaUdalost[] {
  const konec = c.kde + delka;
  const out: SurovaUdalost[] = [];
  let tik = 0;
  let beziciStav = 0;

  while (c.kde < konec && !c.konec) {
    tik += c.varlen();
    let stav = c.nahled();
    if (stav & 0x80) c.bajt();
    else stav = beziciStav; // bezici stav: opakovany prikaz se v souboru vynechava
    if (stav & 0x80 && stav < 0xf0) beziciStav = stav;

    const prikaz = stav & 0xf0;
    const kanal = stav & 0x0f;

    if (stav === 0xff) {
      const typ = c.bajt();
      const dl = c.varlen();
      if (typ === 0x51 && dl === 3) {
        const tempo = (c.bajt() << 16) | (c.bajt() << 8) | c.bajt();
        out.push({ tik, stopa: cisloStopy, typ: 'tempo', midi: 0, kanal: 0, hlasitost: 0, tempo });
      } else {
        c.preskoc(dl);
      }
    } else if (stav === 0xf0 || stav === 0xf7) {
      c.preskoc(c.varlen());
    } else if (prikaz === 0x90 || prikaz === 0x80) {
      const nota = c.bajt();
      const hlasitost = c.bajt();
      // Note-on s nulovou hlasitosti je podle normy note-off.
      const typ = prikaz === 0x90 && hlasitost > 0 ? 'on' : 'off';
      out.push({ tik, stopa: cisloStopy, typ, midi: nota, kanal, hlasitost, tempo: 0 });
    } else if (prikaz === 0xa0 || prikaz === 0xb0 || prikaz === 0xe0) {
      c.preskoc(2);
    } else if (prikaz === 0xc0 || prikaz === 0xd0) {
      c.preskoc(1);
    } else {
      throw new Error(`Nezname MIDI slovo 0x${stav.toString(16)}.`);
    }
  }

  return out;
}

/** Prevede tiky na sekundy podle mapy zmen tempa. */
function casovac(udalosti: readonly SurovaUdalost[], tikuNaDobu: number): (tik: number) => number {
  const zmeny = udalosti
    .filter((u) => u.typ === 'tempo')
    .sort((a, b) => a.tik - b.tik)
    .map((u) => ({ tik: u.tik, tempo: u.tempo }));
  if (zmeny.length === 0 || zmeny[0]!.tik > 0) zmeny.unshift({ tik: 0, tempo: 500_000 });

  const kotvy = [{ tik: 0, cas: 0, tempo: zmeny[0]!.tempo }];
  for (let i = 1; i < zmeny.length; i++) {
    const predchozi = kotvy[kotvy.length - 1]!;
    const cas =
      predchozi.cas + ((zmeny[i]!.tik - predchozi.tik) * predchozi.tempo) / tikuNaDobu / 1e6;
    kotvy.push({ tik: zmeny[i]!.tik, cas, tempo: zmeny[i]!.tempo });
  }

  return (tik) => {
    let k = kotvy[0]!;
    for (const kandidat of kotvy) {
      if (kandidat.tik <= tik) k = kandidat;
      else break;
    }
    return k.cas + ((tik - k.tik) * k.tempo) / tikuNaDobu / 1e6;
  };
}

export function ctiMidi(data: Uint8Array): ObsahMidi {
  const c = new Ctecka(data);
  if (c.znacka() !== 'MThd') throw new Error('Soubor nezacina hlavickou MThd.');
  const delkaHlavicky = c.cislo(4);
  c.cislo(2); // format
  const pocetStop = c.cislo(2);
  const deleni = c.cislo(2);
  c.preskoc(delkaHlavicky - 6);
  if (deleni & 0x8000) throw new Error('Casovani SMPTE zatim nepodporujeme.');

  const vsechny: SurovaUdalost[] = [];
  for (let s = 0; s < pocetStop && !c.konec; s++) {
    if (c.znacka() !== 'MTrk') break;
    const delka = c.cislo(4);
    vsechny.push(...ctiStopu(c, s, delka));
  }

  const naCas = casovac(vsechny, deleni);
  const otevrene = new Map<string, SurovaUdalost>();
  const noty: NotaZMidi[] = [];

  for (const u of vsechny.sort((a, b) => a.tik - b.tik || (a.typ === 'off' ? -1 : 1))) {
    if (u.typ === 'tempo') continue;
    const klic = `${u.stopa}:${u.kanal}:${u.midi}`;
    if (u.typ === 'on') {
      const drive = otevrene.get(klic);
      if (drive) noty.push(uzavri(drive, u.tik, naCas));
      otevrene.set(klic, u);
    } else {
      const drive = otevrene.get(klic);
      if (drive) {
        noty.push(uzavri(drive, u.tik, naCas));
        otevrene.delete(klic);
      }
    }
  }
  for (const [, u] of otevrene) noty.push(uzavri(u, u.tik + deleni, naCas));

  noty.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const prvniTempo = vsechny.find((u) => u.typ === 'tempo')?.tempo ?? 500_000;
  return { noty, bpm: 60_000_000 / prvniTempo, stop: pocetStop };
}

function uzavri(u: SurovaUdalost, tikKonce: number, naCas: (t: number) => number): NotaZMidi {
  return {
    midi: u.midi,
    start: naCas(u.tik),
    konec: naCas(tikKonce),
    hlasitost: u.hlasitost,
    stopa: u.stopa,
    kanal: u.kanal,
  };
}
