import assert from 'node:assert/strict';
import { test } from 'node:test';

import { porovnejNoty } from '../src/jadro/mereni.js';
import { zapisMidi } from '../src/jadro/midi.js';
import { ctiMidi } from '../src/jadro/midiCteni.js';
import { urciOktavovyPosun } from '../src/jadro/oktava.js';
import type { Nota, Udalost } from '../src/jadro/typy.js';

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

/** Tón s několika harmonickými, jak zhruba zní klavír. */
function tonDoVzorku(
  cil: Float32Array,
  midi: number,
  start: number,
  delka: number,
  vzorkovani: number,
): void {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const od = Math.round(start * vzorkovani);
  const doI = Math.min(cil.length, Math.round((start + delka) * vzorkovani));
  for (let i = od; i < doI; i++) {
    const t = (i - od) / vzorkovani;
    const utlum = Math.exp(-t * 2.5);
    cil[i] =
      cil[i]! +
      utlum *
        (Math.sin(2 * Math.PI * f * t) +
          0.45 * Math.sin(4 * Math.PI * f * t) +
          0.2 * Math.sin(6 * Math.PI * f * t));
  }
}

test('MIDI se da precist zpatky tak, jak se zapsalo', () => {
  const noty: Nota[] = [
    { midi: 60, doba: 0, delka: 1, ruka: 'prava', hlasitost: 80 },
    { midi: 64, doba: 1, delka: 0.5, ruka: 'prava', hlasitost: 90 },
    { midi: 43, doba: 0, delka: 2, ruka: 'leva', hlasitost: 70 },
  ];
  const tempo = { bpm: 120, offset: 0, citatel: 4, jmenovatel: 4, shoda: 1 };
  const precteno = ctiMidi(zapisMidi(noty, tempo, 0));

  assert.equal(precteno.noty.length, 3);
  assert.ok(Math.abs(precteno.bpm - 120) < 0.01, `tempo ${precteno.bpm}`);
  assert.deepEqual(
    [...precteno.noty].sort((a, b) => a.midi - b.midi).map((n) => n.midi),
    [43, 60, 64],
  );
  const e = precteno.noty.find((n) => n.midi === 64)!;
  // Pri 120 BPM je doba pul sekundy.
  assert.ok(Math.abs(e.start - 0.5) < 0.01, `zacatek ${e.start}`);
  assert.ok(Math.abs(e.konec - e.start - 0.25) < 0.01, `delka ${e.konec - e.start}`);
});

test('porovnani not pocita jen to, co sedi vyskou i casem', () => {
  const reference = [
    { midi: 60, start: 0 },
    { midi: 64, start: 1 },
    { midi: 67, start: 2 },
  ];
  const nalezene = [
    { midi: 60, start: 0.02 },
    { midi: 63, start: 1.0 },
    { midi: 67, start: 2.3 },
    { midi: 72, start: 3 },
  ];
  const m = porovnejNoty(nalezene, reference, 0.05);
  assert.equal(m.sedi, 1, 'sedi jen prvni nota');
  assert.equal(m.nalezeno, 4);
  assert.equal(m.referencnich, 3);
  assert.ok(Math.abs(m.presnost - 0.25) < 1e-9);
});

test('oktavu urci zvuk, kdyz obraz sahne vedle', { timeout: 120_000 }, () => {
  const vzorkovani = 22050;
  const skutecne = [60, 64, 67, 72, 65, 69, 62, 59, 55, 71, 57, 63, 68, 61, 66, 70];
  const vzorky = new Float32Array(vzorkovani * (skutecne.length + 2));
  const udalosti: Udalost[] = [];
  for (let i = 0; i < skutecne.length; i++) {
    const start = 0.5 + i;
    tonDoVzorku(vzorky, skutecne[i]!, start, 0.9, vzorkovani);
    udalosti.push(udalost(skutecne[i]!, start, 0.9));
  }

  const sedici = urciOktavovyPosun(vzorky, udalosti, { vzorkovani });
  assert.equal(sedici.posun, 0, 'u spravnych vysek nema co posouvat');

  // Tyz zvuk, ale obraz cetl vysky o oktavu niz.
  const oOktavuNiz = udalosti.map((u) => ({ ...u, midi: u.midi - 12 }));
  const opraveno = urciOktavovyPosun(vzorky, oOktavuNiz, { vzorkovani });
  assert.equal(opraveno.posun, 12, 'ma poznat, ze chybi oktava nahoru');

  const oOktavuVys = udalosti.map((u) => ({ ...u, midi: u.midi + 12 }));
  assert.equal(
    urciOktavovyPosun(vzorky, oOktavuVys, { vzorkovani }).posun,
    -12,
    'a stejne tak opacnym smerem',
  );
});
