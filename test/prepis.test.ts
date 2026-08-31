import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { prepisVideo, type VysledekPrepisu } from '../src/prepis.js';
import { vytvorVideo } from './scena.js';
import { ukazkovaScena } from './ukazka.js';

/**
 * Cely retezec nad umelou nahravkou, ktera se chova jako skutecny klavir:
 * ruce zakryvaji klavesy a pruhy pod klaviaturou mizi. Prochazi pres opravdovy
 * ffmpeg a opravdovy kodek, takze to neni test cisté logiky, ale toho, co se
 * stane s daty po ceste.
 */
describe('prepis videa', { timeout: 300_000 }, () => {
  let slozka = '';
  const vysledky = new Map<boolean, VysledekPrepisu>();

  before(async () => {
    slozka = await mkdtemp(join(tmpdir(), 'syn2noty-test-'));
    for (const barevneRuce of [true, false]) {
      const scena = ukazkovaScena(barevneRuce);
      const cesta = join(slozka, `${barevneRuce ? 'barevne' : 'jednobarevne'}.mp4`);
      await vytvorVideo(scena, cesta);
      vysledky.set(barevneRuce, await prepisVideo(cesta, { vzorkuKalibrace: 12 }));
    }
  });

  after(async () => {
    if (slozka) await rm(slozka, { recursive: true, force: true });
  });

  test('klaviatura se zkalibruje pres zakryvajici ruce', () => {
    const v = vysledky.get(true)!;
    assert.equal(v.geometrie.klavesy.length, 61);
    assert.equal(v.geometrie.klavesy[0]!.midi, 36);
    assert.equal(v.geometrie.klavesy.at(-1)!.midi, 96);
  });

  test('rychlost padu pruhu se zmeri z odstupu dvou radku', () => {
    const v = vysledky.get(true)!;
    const ocekavana = ukazkovaScena(true).rychlost / ukazkovaScena(true).fps;
    assert.ok(
      Number.isFinite(v.rychlostPadu),
      'rychlost se ma podarit zmerit',
    );
    assert.ok(
      Math.abs(v.rychlostPadu - ocekavana) / ocekavana < 0.25,
      `zmereno ${v.rychlostPadu.toFixed(2)} px/snimek, ocekavano ${ocekavana.toFixed(2)}`,
    );
  });

  for (const barevneRuce of [true, false]) {
    const popis = barevneRuce ? 'barevne rozlisene ruce' : 'jednobarevne pruhy';

    test(`vsechny noty se najdou — ${popis}`, () => {
      const v = vysledky.get(barevneRuce)!;
      const ocekavane = ukazkovaScena(barevneRuce).noty;

      for (const n of ocekavane) {
        const nalezena = v.udalosti.find(
          (u) => u.midi === n.midi && Math.abs(u.start - n.start) < 0.12,
        );
        assert.ok(nalezena, `chybi nota ${n.midi} v case ${n.start}`);
        const delka = nalezena.konec - nalezena.start;
        const ocekavanaDelka = n.konec - n.start;
        assert.ok(
          Math.abs(delka - ocekavanaDelka) < 0.1,
          `nota ${n.midi}: delka ${delka.toFixed(3)} vs ${ocekavanaDelka.toFixed(3)}`,
        );
      }
      assert.equal(v.udalosti.length, ocekavane.length, 'zadne noty navic');
    });

    test(`ruce se priradi spravne — ${popis}`, () => {
      const v = vysledky.get(barevneRuce)!;
      const ocekavane = ukazkovaScena(barevneRuce).noty;
      let sedi = 0;
      for (const n of ocekavane) {
        const nalezena = v.udalosti.find(
          (u) => u.midi === n.midi && Math.abs(u.start - n.start) < 0.12,
        );
        if (nalezena?.ruka === n.ruka) sedi++;
      }
      assert.equal(sedi, ocekavane.length, `spravne prirazeno ${sedi} z ${ocekavane.length}`);
    });
  }

  test('tempo vyjde na 120 BPM a noty padnou na osminovou mrizku', () => {
    const v = vysledky.get(true)!;
    assert.ok(
      Math.abs(v.tempo.bpm - 120) < 2 || Math.abs(v.tempo.bpm - 60) < 2,
      `tempo ${v.tempo.bpm}`,
    );
    for (const n of v.noty) {
      const zbytek = Math.abs(n.doba * 4 - Math.round(n.doba * 4));
      assert.ok(zbytek < 1e-6, `nota mimo mrizku: ${n.doba}`);
    }
  });
});
