#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { zapisMidi } from './jadro/midi.js';
import { zapisMusicXml } from './jadro/notace.js';
import { prepisVideo, type NastaveniPrepisu } from './prepis.js';

interface Prepinace {
  video: string;
  vystup: string;
  json: boolean;
  ticho: boolean;
  nastaveni: NastaveniPrepisu;
}

const NAPOVEDA = `syn2noty — prevede video klaviru se synesthesia efekty na noty

  syn2noty <video> [prepinace]

  -o, --out <slozka>     kam ulozit vysledky (vychozi: vedle videa)
      --bpm <cislo>      pevne tempo misto odhadu
      --takt <4/4>       taktove oznaceni
      --deleni <4>       nejmensi delena doba: 4 = sestnactiny, 3 = trioly
      --prvni-midi <21>  MIDI cislo nejlevejsi bile klavesy
      --prah <0.12>      prah detekce pruhu, 0..1
      --hrany <a,b>      rucni horni a dolni hrana klaviatury v pixelech
      --pomer-souseda <1.8>  kolikrat silnejsi soused zahodi klavesu jako preteceni
      --bez-zvuku        neporovnavat se zvukovou stopou
      --json             vypsat vysledek jako JSON na standardni vystup
      --ticho            nevypisovat prubeh
  -h, --help             tato napoveda
`;

function zpracujArgumenty(argv: readonly string[]): Prepinace | null {
  const nastaveni: NastaveniPrepisu = { tempo: {}, detekce: {}, klaviatura: {} };
  let video = '';
  let vystup = '';
  let json = false;
  let ticho = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const dalsi = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Prepinac ${a} ocekava hodnotu.`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': return null;
      case '-o': case '--out': vystup = dalsi(); break;
      case '--bpm': nastaveni.tempo!.bpm = Number(dalsi()); break;
      case '--deleni': nastaveni.tempo!.deleni = Number(dalsi()); break;
      case '--prah': nastaveni.detekce!.prah = Number(dalsi()); break;
      case '--prvni-midi': nastaveni.klaviatura!.prvniMidi = Number(dalsi()); break;
      case '--pomer-souseda': nastaveni.detekce!.pomerSouseda = Number(dalsi()); break;
      case '--bez-zvuku': nastaveni.bezZvuku = true; break;
      case '--json': json = true; break;
      case '--ticho': ticho = true; break;
      case '--takt': {
        const [citatel, jmenovatel] = dalsi().split('/');
        nastaveni.tempo!.citatel = Number(citatel);
        nastaveni.tempo!.jmenovatel = Number(jmenovatel ?? 4);
        break;
      }
      case '--hrany': {
        const [horni, dolni] = dalsi().split(',');
        nastaveni.klaviatura!.hornihrana = Number(horni);
        nastaveni.klaviatura!.dolniHrana = Number(dolni);
        break;
      }
      default:
        if (a.startsWith('-')) throw new Error(`Nezname prepinace: ${a}`);
        video = a;
    }
  }

  if (!video) return null;
  return { video, vystup: vystup || '.', json, ticho, nastaveni };
}

async function hlavni(): Promise<number> {
  let prepinace: Prepinace | null;
  try {
    prepinace = zpracujArgumenty(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${NAPOVEDA}`);
    return 2;
  }
  if (!prepinace) {
    process.stdout.write(NAPOVEDA);
    return 0;
  }

  const nazev = basename(prepinace.video, extname(prepinace.video));
  // Prubeh jde na chybovy vystup i pri --json: volajici tak muze ukazovat, co se
  // deje, a zaroven si precist vysledek ze standardniho vystupu.
  if (!prepinace.ticho) {
    prepinace.nastaveni.naStav = (z) => process.stderr.write(`  ${z}\n`);
  }

  const vysledek = await prepisVideo(prepinace.video, prepinace.nastaveni);

  await mkdir(prepinace.vystup, { recursive: true });
  const cestaMidi = join(prepinace.vystup, `${nazev}.mid`);
  const cestaXml = join(prepinace.vystup, `${nazev}.musicxml`);

  await writeFile(
    cestaMidi,
    zapisMidi(vysledek.noty, vysledek.tempo, vysledek.tonina.kvinty, { nazev }),
  );
  await writeFile(
    cestaXml,
    zapisMusicXml(vysledek.noty, vysledek.tempo, vysledek.tonina.kvinty, {
      nazev,
      delicBod: vysledek.delicBod,
    }),
    'utf8',
  );

  if (prepinace.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          video: prepinace.video,
          midi: cestaMidi,
          musicxml: cestaXml,
          klaves: vysledek.geometrie.klavesy.length,
          snimku: vysledek.stopa.pocetSnimku,
          not: vysledek.noty.length,
          tempo: vysledek.tempo,
          predznamenani: vysledek.tonina.kvinty,
          prah: Number(vysledek.prah.toFixed(3)),
          rychlostPadu: Number.isFinite(vysledek.rychlostPadu) ? vysledek.rychlostPadu : null,
          zvuk: {
            posunMs: Math.round(vysledek.sladeni.posun * 1000),
            presnost: Number(vysledek.sladeni.presnost.toFixed(2)),
            pokryti: Number(vysledek.sladeni.pokryti.toFixed(2)),
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(`  hotovo: ${cestaMidi}\n  hotovo: ${cestaXml}\n`);
  }
  return 0;
}

hlavni().then(
  (kod) => process.exit(kod),
  (chyba: unknown) => {
    process.stderr.write(`Chyba: ${(chyba as Error).message}\n`);
    process.exit(1);
  },
);
