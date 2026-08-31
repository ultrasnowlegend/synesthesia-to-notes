import assert from 'node:assert/strict';
import { test } from 'node:test';

import { najdiKlaviaturu } from '../src/jadro/klaviatura.js';
import { zapisMidi } from '../src/jadro/midi.js';
import { rozlozDelku, zapisMusicXml } from '../src/jadro/notace.js';
import { medianSnimku, type Obraz } from '../src/jadro/obraz.js';
import { kvantizuj, odhadniTempo } from '../src/jadro/tempo.js';
import { odhadniToninu, zapisTonu } from '../src/jadro/tonina.js';
import type { Nota, Udalost } from '../src/jadro/typy.js';
import { klavesySceny, vykresliSnimek } from './scena.js';
import { ukazkovaScena } from './ukazka.js';

function udalost(midi: number, start: number, delka: number): Udalost {
  return {
    midi,
    start,
    konec: start + delka,
    ruka: 'neznama',
    barva: { r: 0, g: 0, b: 0 },
    jistota: 1,
  };
}

test('median snimku odstrani ruce a odhali holou klaviaturu', () => {
  const scena = ukazkovaScena(true);
  const snimky: Obraz[] = [];
  for (let i = 0; i < 15; i++) {
    snimky.push({
      sirka: scena.sirka,
      vyska: scena.vyska,
      data: vykresliSnimek(scena, (scena.delka * (i + 0.5)) / 15),
    });
  }
  const pozadi = medianSnimku(snimky);
  const g = najdiKlaviaturu(pozadi);

  assert.equal(g.klavesy.length, 61, 'ma najit vsech 61 klaves');
  assert.equal(g.klavesy[0]!.midi, 36, 'nejnizsi klavesa je C2');
  assert.equal(g.klavesy[g.klavesy.length - 1]!.midi, 96, 'nejvyssi klavesa je C7');
  assert.ok(Math.abs(g.hornihrana - scena.hornihrana) <= 2, `horni hrana ${g.hornihrana}`);
  assert.ok(g.radekDopadu < g.hornihrana, 'radek dopadu lezi nad klaviaturou');
  assert.ok(g.radekVyssi < g.radekDopadu, 'druhy radek lezi jeste vys');

  const ocekavane = new Map(klavesySceny(scena).map((k) => [k.midi, (k.x1 + k.x2) / 2]));
  for (const k of g.klavesy) {
    const stred = ocekavane.get(k.midi);
    assert.ok(stred !== undefined, `klavesa ${k.midi} ma existovat`);
    assert.ok(
      Math.abs(k.stred - stred!) < 6,
      `stred klavesy ${k.midi}: ${k.stred.toFixed(1)} vs ${stred!.toFixed(1)}`,
    );
  }
});

test('hrebenovy filtr najde tempo pravidelne pasaze', () => {
  const udalosti: Udalost[] = [];
  for (let i = 0; i < 24; i++) udalosti.push(udalost(60 + (i % 4), 0.4 + i * 0.5, 0.45));
  const tempo = odhadniTempo(udalosti);
  assert.ok(Math.abs(tempo.bpm - 120) < 1.5, `ocekavano 120 BPM, vyslo ${tempo.bpm}`);
  assert.ok(tempo.shoda > 0.9, `mrizka ma sedet, shoda ${tempo.shoda}`);
});

test('kvantizace prichyti noty na mrizku a nezkrati je na nulu', () => {
  const udalosti = [udalost(60, 0.02, 0.24), udalost(64, 0.51, 0.48), udalost(67, 1.01, 0.02)];
  const tempo = { bpm: 120, offset: 0, citatel: 4, jmenovatel: 4, shoda: 1 };
  const noty = kvantizuj(udalosti, tempo, { deleni: 4 });
  assert.equal(noty.length, 3);
  assert.deepEqual(
    noty.map((n) => [n.doba, n.delka]),
    [
      [0, 0.5],
      [1, 1],
      [2, 0.25],
    ],
  );
});

test('tonina se urcuje z delek, ne z poctu tonu', () => {
  // Zamerne prevazuje G a D delkou, ne poctem: krizkove C by tuto melodii
  // poslalo do D dur, kdyby se scitaly vyskyty misto trvani.
  const noty: Nota[] = [
    { midi: 67, doba: 0, delka: 6, ruka: 'prava', hlasitost: 80 },
    { midi: 74, doba: 6, delka: 3, ruka: 'prava', hlasitost: 80 },
    { midi: 71, doba: 9, delka: 3, ruka: 'prava', hlasitost: 80 },
    { midi: 69, doba: 12, delka: 2, ruka: 'prava', hlasitost: 80 },
    { midi: 64, doba: 14, delka: 2, ruka: 'prava', hlasitost: 80 },
    { midi: 60, doba: 16, delka: 2, ruka: 'prava', hlasitost: 80 },
    { midi: 66, doba: 18, delka: 1.5, ruka: 'prava', hlasitost: 80 },
    { midi: 61, doba: 19.5, delka: 0.25, ruka: 'prava', hlasitost: 80 },
  ];
  const tonina = odhadniToninu(noty);
  assert.equal(tonina.kvinty, 1, 'G dur ma jeden krizek');
  assert.equal(zapisTonu(66, 1).krok, 'F');
  assert.equal(zapisTonu(66, 1).posuv, 1);
  assert.equal(zapisTonu(70, -2).krok, 'B');
  assert.equal(zapisTonu(70, -2).posuv, -1);
});

test('delky se rozkladaji na zapsatelne hodnoty', () => {
  assert.deepEqual(rozlozDelku(24).map((h) => h.typ), ['quarter']);
  assert.deepEqual(rozlozDelku(36).map((h) => [h.typ, h.tecky]), [['quarter', 1]]);
  assert.deepEqual(rozlozDelku(8), [{ dilku: 8, typ: 'eighth', tecky: 0, triola: true }]);
  const rozlozene = rozlozDelku(30);
  assert.deepEqual(rozlozene.map((h) => h.typ), ['quarter', '16th']);
  assert.equal(rozlozene.reduce((s, h) => s + h.dilku, 0), 30);
});

test('MusicXML ma dve osnovy a spravny pocet taktu', () => {
  const noty: Nota[] = [
    { midi: 72, doba: 0, delka: 1, ruka: 'prava', hlasitost: 80 },
    { midi: 48, doba: 0, delka: 2, ruka: 'leva', hlasitost: 80 },
    { midi: 74, doba: 4.5, delka: 0.5, ruka: 'prava', hlasitost: 80 },
  ];
  const xml = zapisMusicXml(noty, { bpm: 120, offset: 0, citatel: 4, jmenovatel: 4, shoda: 1 }, 0);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign>/);
  assert.equal((xml.match(/<measure number=/g) ?? []).length, 2);
  assert.match(xml, /<divisions>24<\/divisions>/);
});

test('MIDI soubor ma hlavicku a tri stopy', () => {
  const data = zapisMidi(
    [
      { midi: 60, doba: 0, delka: 1, ruka: 'prava', hlasitost: 80 },
      { midi: 48, doba: 0, delka: 2, ruka: 'leva', hlasitost: 70 },
    ],
    { bpm: 96, offset: 0, citatel: 3, jmenovatel: 4, shoda: 1 },
    -2,
  );
  assert.deepEqual([...data.subarray(0, 4)], [0x4d, 0x54, 0x68, 0x64]);
  const text = Buffer.from(data).toString('latin1');
  assert.equal(text.split('MTrk').length - 1, 3, 'ridici stopa a dve ruce');
  assert.equal(data[11], 3, 'hlavicka hlasi tri stopy');
});
