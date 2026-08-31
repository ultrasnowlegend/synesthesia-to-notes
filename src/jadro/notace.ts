import { zapisTonu } from './tonina.js';
import type { Nota, Tempo } from './typy.js';

/** Dilku na jednu dobu. 24 pokryje sestnactiny (6) i osminove trioly (8). */
export const DILKU_NA_DOBU = 24;

export interface NastaveniNotace {
  nazev?: string;
  autor?: string;
  /** MIDI cislo, pod kterym noty bez urcene ruky padnou do basoveho klice. */
  delicBod?: number;
}

interface HodnotaNoty {
  dilku: number;
  typ: string;
  tecky: number;
  triola: boolean;
}

/** Binarni notove hodnoty vcetne teckovanych, sestupne podle delky. */
const HODNOTY: readonly (readonly [number, string, number])[] = [
  [192, 'breve', 0],
  [144, 'whole', 1],
  [96, 'whole', 0],
  [72, 'half', 1],
  [48, 'half', 0],
  [36, 'quarter', 1],
  [24, 'quarter', 0],
  [18, 'eighth', 1],
  [12, 'eighth', 0],
  [9, '16th', 1],
  [6, '16th', 0],
  [3, '32nd', 0],
];

function presnaHodnota(dilku: number): HodnotaNoty | null {
  for (const [d, typ, tecky] of HODNOTY) {
    if (d === dilku) return { dilku, typ, tecky, triola: false };
  }
  // Triola: zabira dve tretiny sve psane hodnoty, proto hledame delku * 3/2.
  if ((dilku * 3) % 2 === 0) {
    const psana = (dilku * 3) / 2;
    for (const [d, typ, tecky] of HODNOTY) {
      if (d === psana) return { dilku, typ, tecky, triola: true };
    }
  }
  return null;
}

/** Rozlozi libovolnou delku na retezec zapsatelnych hodnot spojenych ligaturou. */
export function rozlozDelku(dilku: number): HodnotaNoty[] {
  const presna = presnaHodnota(dilku);
  if (presna) return [presna];

  const out: HodnotaNoty[] = [];
  let zbytek = dilku;
  while (zbytek >= 3 && out.length < 8) {
    const nalezena = HODNOTY.find(([d]) => d <= zbytek);
    if (!nalezena) break;
    out.push({ dilku: nalezena[0], typ: nalezena[1], tecky: nalezena[2], triola: false });
    zbytek -= nalezena[0];
  }
  if (out.length === 0) out.push({ dilku: 3, typ: '32nd', tecky: 0, triola: false });
  return out;
}

interface NotaTik {
  midi: number;
  start: number;
  delka: number;
}

interface Polozka {
  start: number;
  delka: number;
  /** Prazdne pole znamena pomlku. */
  noty: NotaTik[];
}

/**
 * Prevede noty jedne osnovy na souvislou radu akordu a pomlk bez prekryvu.
 * Vice hlasu v jedne osnove zamerne neresime: pro precteni improvizace je
 * jednohlasy zapis s akordy citelnejsi nez automaticky rozdelene hlasy.
 */
function osnovaNaPolozky(noty: readonly NotaTik[], konec: number): Polozka[] {
  const podleStartu = new Map<number, NotaTik[]>();
  for (const n of noty) {
    const seznam = podleStartu.get(n.start);
    if (seznam) seznam.push(n);
    else podleStartu.set(n.start, [n]);
  }
  const starty = [...podleStartu.keys()].sort((a, b) => a - b);

  const out: Polozka[] = [];
  let kurzor = 0;
  for (let i = 0; i < starty.length; i++) {
    const start = starty[i]!;
    if (start > kurzor) out.push({ start: kurzor, delka: start - kurzor, noty: [] });
    const skupina = podleStartu.get(start)!;
    const dalsi = starty[i + 1] ?? konec;
    const delka = Math.max(1, Math.min(Math.min(...skupina.map((n) => n.delka)), dalsi - start));
    out.push({ start, delka, noty: skupina });
    kurzor = start + delka;
  }
  if (kurzor < konec) out.push({ start: kurzor, delka: konec - kurzor, noty: [] });
  return out;
}

interface Fragment extends Polozka {
  vazeNaDalsi: boolean;
  vazeNaPredchozi: boolean;
}

/** Rozdeli polozky na hranicich taktu a oznaci ligatury. */
function rozdelPoTaktech(polozky: readonly Polozka[], delkaTaktu: number): Fragment[][] {
  const takty: Fragment[][] = [];
  const doTaktu = (f: Fragment): void => {
    const index = Math.floor(f.start / delkaTaktu);
    while (takty.length <= index) takty.push([]);
    takty[index]!.push(f);
  };

  for (const p of polozky) {
    let start = p.start;
    let zbyva = p.delka;
    let prvni = true;
    while (zbyva > 0) {
      const konecTaktu = (Math.floor(start / delkaTaktu) + 1) * delkaTaktu;
      const delka = Math.min(zbyva, konecTaktu - start);
      const posledni = delka === zbyva;
      doTaktu({
        start,
        delka,
        noty: p.noty,
        vazeNaDalsi: p.noty.length > 0 && !posledni,
        vazeNaPredchozi: p.noty.length > 0 && !prvni,
      });
      start += delka;
      zbyva -= delka;
      prvni = false;
    }
  }
  return takty;
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function zapisNotu(
  f: Fragment,
  hodnota: HodnotaNoty,
  poradiHodnoty: number,
  pocetHodnot: number,
  osnova: number,
  kvinty: number,
): string {
  const radky: string[] = [];
  const vazeZ = f.vazeNaPredchozi || poradiHodnoty > 0;
  const vazeDo = f.vazeNaDalsi || poradiHodnoty < pocetHodnot - 1;

  if (f.noty.length === 0) {
    radky.push('      <note>');
    radky.push('        <rest/>');
    radky.push(`        <duration>${hodnota.dilku}</duration>`);
    radky.push(`        <voice>${osnova}</voice>`);
    radky.push(`        <type>${hodnota.typ}</type>`);
    for (let i = 0; i < hodnota.tecky; i++) radky.push('        <dot/>');
    radky.push(`        <staff>${osnova}</staff>`);
    radky.push('      </note>');
    return radky.join('\n');
  }

  const serazene = [...f.noty].sort((a, b) => a.midi - b.midi);
  for (let i = 0; i < serazene.length; i++) {
    const n = serazene[i]!;
    const t = zapisTonu(n.midi, kvinty);
    radky.push('      <note>');
    if (i > 0) radky.push('        <chord/>');
    radky.push('        <pitch>');
    radky.push(`          <step>${t.krok}</step>`);
    if (t.posuv !== 0) radky.push(`          <alter>${t.posuv}</alter>`);
    radky.push(`          <octave>${t.oktava}</octave>`);
    radky.push('        </pitch>');
    radky.push(`        <duration>${hodnota.dilku}</duration>`);
    if (vazeZ) radky.push('        <tie type="stop"/>');
    if (vazeDo) radky.push('        <tie type="start"/>');
    radky.push(`        <voice>${osnova}</voice>`);
    radky.push(`        <type>${hodnota.typ}</type>`);
    for (let d = 0; d < hodnota.tecky; d++) radky.push('        <dot/>');
    if (hodnota.triola) {
      radky.push('        <time-modification>');
      radky.push('          <actual-notes>3</actual-notes>');
      radky.push('          <normal-notes>2</normal-notes>');
      radky.push('        </time-modification>');
    }
    radky.push(`        <staff>${osnova}</staff>`);
    if (vazeZ || vazeDo) {
      radky.push('        <notations>');
      if (vazeZ) radky.push('          <tied type="stop"/>');
      if (vazeDo) radky.push('          <tied type="start"/>');
      radky.push('        </notations>');
    }
    radky.push('      </note>');
  }
  return radky.join('\n');
}

function zapisFragmenty(fragmenty: readonly Fragment[], osnova: number, kvinty: number): string {
  const out: string[] = [];
  for (const f of fragmenty) {
    const hodnoty = rozlozDelku(f.delka);
    for (let i = 0; i < hodnoty.length; i++) {
      out.push(zapisNotu(f, hodnoty[i]!, i, hodnoty.length, osnova, kvinty));
    }
  }
  return out.join('\n');
}

/** Vygeneruje MusicXML pro klavir se dvema osnovami. */
export function zapisMusicXml(
  noty: readonly Nota[],
  tempo: Tempo,
  kvinty: number,
  nastaveni: NastaveniNotace = {},
): string {
  const delicBod = nastaveni.delicBod ?? 60;
  const naTiky = (n: Nota): NotaTik => ({
    midi: n.midi,
    start: Math.round(n.doba * DILKU_NA_DOBU),
    delka: Math.max(1, Math.round(n.delka * DILKU_NA_DOBU)),
  });

  const prava = noty
    .filter((n) => (n.ruka === 'neznama' ? n.midi >= delicBod : n.ruka === 'prava'))
    .map(naTiky);
  const leva = noty
    .filter((n) => (n.ruka === 'neznama' ? n.midi < delicBod : n.ruka === 'leva'))
    .map(naTiky);

  const delkaTaktu = Math.round((tempo.citatel * 4 * DILKU_NA_DOBU) / tempo.jmenovatel);
  const posledni = Math.max(
    delkaTaktu,
    ...prava.map((n) => n.start + n.delka),
    ...leva.map((n) => n.start + n.delka),
  );
  const konec = Math.ceil(posledni / delkaTaktu) * delkaTaktu;

  const taktyPrava = rozdelPoTaktech(osnovaNaPolozky(prava, konec), delkaTaktu);
  const taktyLeva = rozdelPoTaktech(osnovaNaPolozky(leva, konec), delkaTaktu);
  const pocetTaktu = Math.max(taktyPrava.length, taktyLeva.length, 1);

  const casti: string[] = [];
  casti.push('<?xml version="1.0" encoding="UTF-8"?>');
  casti.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  casti.push('<score-partwise version="4.0">');
  casti.push('  <work>');
  casti.push(`    <work-title>${xml(nastaveni.nazev ?? 'Prepis improvizace')}</work-title>`);
  casti.push('  </work>');
  casti.push('  <identification>');
  casti.push(`    <creator type="composer">${xml(nastaveni.autor ?? '')}</creator>`);
  casti.push('    <encoding>');
  casti.push('      <software>synesthesia-to-notes</software>');
  casti.push('    </encoding>');
  casti.push('  </identification>');
  casti.push('  <part-list>');
  casti.push('    <score-part id="P1">');
  casti.push('      <part-name>Klavir</part-name>');
  casti.push('    </score-part>');
  casti.push('  </part-list>');
  casti.push('  <part id="P1">');

  for (let i = 0; i < pocetTaktu; i++) {
    casti.push(`    <measure number="${i + 1}">`);
    if (i === 0) {
      casti.push('      <attributes>');
      casti.push(`        <divisions>${DILKU_NA_DOBU}</divisions>`);
      casti.push('        <key>');
      casti.push(`          <fifths>${kvinty}</fifths>`);
      casti.push('        </key>');
      casti.push('        <time>');
      casti.push(`          <beats>${tempo.citatel}</beats>`);
      casti.push(`          <beat-type>${tempo.jmenovatel}</beat-type>`);
      casti.push('        </time>');
      casti.push('        <staves>2</staves>');
      casti.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      casti.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      casti.push('      </attributes>');
      casti.push('      <direction placement="above">');
      casti.push('        <direction-type>');
      casti.push('          <metronome>');
      casti.push('            <beat-unit>quarter</beat-unit>');
      casti.push(`            <per-minute>${Math.round(tempo.bpm)}</per-minute>`);
      casti.push('          </metronome>');
      casti.push('        </direction-type>');
      casti.push(`        <sound tempo="${Math.round(tempo.bpm)}"/>`);
      casti.push('      </direction>');
    }
    casti.push(zapisFragmenty(taktyPrava[i] ?? [{ start: i * delkaTaktu, delka: delkaTaktu, noty: [], vazeNaDalsi: false, vazeNaPredchozi: false }], 1, kvinty));
    casti.push(`      <backup><duration>${delkaTaktu}</duration></backup>`);
    casti.push(zapisFragmenty(taktyLeva[i] ?? [{ start: i * delkaTaktu, delka: delkaTaktu, noty: [], vazeNaDalsi: false, vazeNaPredchozi: false }], 2, kvinty));
    casti.push('    </measure>');
  }

  casti.push('  </part>');
  casti.push('</score-partwise>');
  return casti.join('\n');
}
