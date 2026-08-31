import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zapisMidi } from '../../src/jadro/midi.js';
import { zapisMusicXml } from '../../src/jadro/notace.js';
import { kvantizuj, odhadniTempo, zarovnejNaZacatek } from '../../src/jadro/tempo.js';
import { odhadniToninu } from '../../src/jadro/tonina.js';
import type { GeometrieKlaviatury, Nota, Udalost } from '../../src/jadro/typy.js';
import { nakresliKalibraci, nakresliRolku } from '../../src/jadro/nahledy.js';
import { prepisVideo, type NastaveniPrepisu, type VysledekPrepisu } from '../../src/prepis.js';
import type { NastaveniMrizky, Odpoved, Souhrn } from './sdilene.js';

const slozka = fileURLToPath(new URL('.', import.meta.url));

/**
 * Hlavni proces drzi vysledek prepisu v pameti, takze zmena tempa nebo mrizky
 * uz nesaha na video ani na stopu barev a prekresli noty okamzite. Presne kvuli
 * tomuhle cyklu se stopa vubec pocita.
 */
let posledni: {
  cesta: string;
  vysledek: VysledekPrepisu;
  udalosti: Udalost[];
  noty: Nota[];
  musicxml: string;
} | null = null;

let okno: BrowserWindow | null = null;

function obal<T, A extends unknown[]>(
  f: (...args: A) => Promise<T> | T,
): (...args: A) => Promise<Odpoved<T>> {
  return async (...args: A): Promise<Odpoved<T>> => {
    try {
      return { ok: true, data: await f(...args) };
    } catch (e) {
      return { ok: false, chyba: (e as Error).message };
    }
  };
}

const NAZVY_TONIN = [
  'Ces dur / as moll',
  'Ges dur / es moll',
  'Des dur / b moll',
  'As dur / f moll',
  'Es dur / c moll',
  'B dur / g moll',
  'F dur / d moll',
  'C dur / a moll',
  'G dur / e moll',
  'D dur / h moll',
  'A dur / fis moll',
  'E dur / cis moll',
  'H dur / gis moll',
  'Fis dur / dis moll',
  'Cis dur / ais moll',
];

function nazevToniny(kvinty: number): string {
  return NAZVY_TONIN[Math.max(0, Math.min(14, kvinty + 7))] ?? '';
}

let verovio: { loadData: (d: string) => boolean; getPageCount: () => number; renderToSVG: (s: number) => string; setOptions: (o: unknown) => void } | null = null;

async function sazec(): Promise<NonNullable<typeof verovio>> {
  if (verovio) return verovio;
  const { default: createVerovioModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions({
    pageWidth: 2100,
    pageHeight: 2970,
    scale: 38,
    adjustPageHeight: false,
    footer: 'none',
    header: 'none',
    spacingStaff: 10,
  });
  verovio = tk as unknown as NonNullable<typeof verovio>;
  return verovio;
}

function dataUrl(rgb: Uint8Array, sirka: number, vyska: number): string {
  // nativeImage cte BGRA, nase vykreslovani RGB; prevod je levnejsi nez tahat
  // do projektu kodovani PNG.
  const bgra = Buffer.alloc(sirka * vyska * 4);
  for (let i = 0, j = 0; i < sirka * vyska; i++, j += 4) {
    bgra[j] = rgb[i * 3 + 2]!;
    bgra[j + 1] = rgb[i * 3 + 1]!;
    bgra[j + 2] = rgb[i * 3]!;
    bgra[j + 3] = 255;
  }
  return nativeImage.createFromBitmap(bgra, { width: sirka, height: vyska }).toDataURL();
}

function prepocitej(nastaveni: NastaveniMrizky): Souhrn {
  if (!posledni) throw new Error('Nejdriv je potreba prepsat video.');
  const { vysledek, udalosti } = posledni;

  const tempo = odhadniTempo(udalosti, nastaveni);
  const noty = kvantizuj(udalosti, tempo, nastaveni);
  zarovnejNaZacatek(noty);
  const tonina = odhadniToninu(noty);
  const musicxml = zapisMusicXml(noty, tempo, tonina.kvinty, {
    nazev: basename(posledni.cesta, extname(posledni.cesta)),
    delicBod: vysledek.delicBod,
    legato: nastaveni.legato,
  });

  posledni.noty = noty;
  posledni.musicxml = musicxml;

  const rozsah = udalosti.reduce(
    (r, u) => [Math.min(r[0], u.midi), Math.max(r[1], u.midi)] as [number, number],
    [127, 0] as [number, number],
  );

  return {
    video: posledni.cesta,
    delka: vysledek.info.delka,
    fps: vysledek.info.fps,
    snimku: vysledek.stopa.pocetSnimku,
    klaves: vysledek.geometrie.klavesy.length,
    rozsah,
    udalosti: udalosti.length,
    noty: noty.length,
    tempo,
    kvinty: tonina.kvinty,
    tonina: nazevToniny(tonina.kvinty),
    prah: vysledek.prah,
    sladeni: vysledek.sladeni,
    hornihrana: vysledek.geometrie.hornihrana,
    dolniHrana: vysledek.geometrie.dolniHrana,
    prvniMidi: (vysledek.geometrie.klavesy.find((k) => !k.cerna) as GeometrieKlaviatury['klavesy'][number]).midi,
    levouRukou: udalosti.filter((u) => u.ruka === 'leva').length,
    nahledKalibrace: '',
    nahledRolky: '',
    stran: 0,
  };
}

function vytvorOkno(): void {
  okno = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#12141a',
    title: 'Z videa zpět do not',
    webPreferences: { preload: fileURLToPath(new URL('preload.mjs', import.meta.url)), sandbox: false },
  });

  if (process.env['VITE_DEV_SERVER_URL']) {
    void okno.loadURL(process.env['VITE_DEV_SERVER_URL']);
  } else {
    void okno.loadFile(`${slozka}../dist-app/index.html`);
  }
}

ipcMain.handle(
  'syn2noty:vyber-video',
  obal(async () => {
    const v = await dialog.showOpenDialog({
      title: 'Vyber video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
    });
    return v.canceled ? null : (v.filePaths[0] ?? null);
  }),
);

ipcMain.handle(
  'syn2noty:prepis',
  obal(async (_e: unknown, cesta: string, rucni: NastaveniPrepisu & NastaveniMrizky) => {
    const nastaveni: NastaveniPrepisu = {
      klaviatura: rucni.klaviatura ?? {},
      detekce: rucni.detekce ?? {},
      naStav: (z) => okno?.webContents.send('syn2noty:stav', z),
    };
    const vysledek = await prepisVideo(cesta, nastaveni);
    posledni = { cesta, vysledek, udalosti: vysledek.udalosti, noty: vysledek.noty, musicxml: '' };

    const souhrn = prepocitej(rucni);
    const kal = nakresliKalibraci(vysledek.geometrie, vysledek.pozadi);
    souhrn.nahledKalibrace = dataUrl(kal.data, kal.sirka, kal.vyska);
    const roll = nakresliRolku(vysledek.udalosti, vysledek.info.delka);
    souhrn.nahledRolky = dataUrl(roll.data, roll.sirka, roll.vyska);
    souhrn.stran = (await sazec()).loadData(posledni.musicxml) ? (await sazec()).getPageCount() : 0;
    return souhrn;
  }),
);

ipcMain.handle(
  'syn2noty:prekvantuj',
  obal(async (_e: unknown, nastaveni: NastaveniMrizky) => {
    const souhrn = prepocitej(nastaveni);
    const tk = await sazec();
    souhrn.stran = tk.loadData(posledni!.musicxml) ? tk.getPageCount() : 0;
    return souhrn;
  }),
);

ipcMain.handle(
  'syn2noty:strana',
  obal(async (_e: unknown, cislo: number) => {
    const tk = await sazec();
    return tk.renderToSVG(cislo);
  }),
);

ipcMain.handle(
  'syn2noty:export',
  obal(async (_e: unknown, typ: 'midi' | 'musicxml' | 'pdf') => {
    if (!posledni) throw new Error('Neni co exportovat.');
    const zaklad = basename(posledni.cesta, extname(posledni.cesta));
    const pripona = typ === 'midi' ? 'mid' : typ === 'musicxml' ? 'musicxml' : 'pdf';
    const v = await dialog.showSaveDialog({
      defaultPath: `${zaklad}.${pripona}`,
      filters: [{ name: pripona.toUpperCase(), extensions: [pripona] }],
    });
    if (v.canceled || !v.filePath) return null;

    if (typ === 'midi') {
      const t = odhadniToninu(posledni.noty);
      await writeFile(v.filePath, zapisMidi(posledni.noty, posledni.vysledek.tempo, t.kvinty, { nazev: zaklad }));
    } else if (typ === 'musicxml') {
      await writeFile(v.filePath, posledni.musicxml, 'utf8');
    } else {
      await ulozPdf(v.filePath);
    }
    return v.filePath;
  }),
);

ipcMain.handle('syn2noty:otevri-slozku', obal((_e: unknown, cesta: string) => shell.showItemInFolder(cesta)));

/**
 * PDF sazi skryte okno pres printToPDF. Verovio uz noty vykreslilo do SVG,
 * takze staci stranky poskladat za sebe; druhy sazeci engine by byl zbytecny.
 */
async function ulozPdf(cesta: string): Promise<void> {
  const tk = await sazec();
  const stran = tk.getPageCount();
  const strany: string[] = [];
  for (let i = 1; i <= stran; i++) strany.push(tk.renderToSVG(i));

  const html = `<!doctype html><meta charset="utf-8"><style>
    @page { size: A4; margin: 0 }
    html,body { margin:0; padding:0; background:#fff }
    .strana { width:210mm; height:297mm; page-break-after:always; overflow:hidden }
    .strana:last-child { page-break-after:auto }
    .strana svg { width:100%; height:100% }
  </style>${strany.map((s) => `<div class="strana">${s}</div>`).join('')}`;

  const tiskarna = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await tiskarna.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await tiskarna.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await writeFile(cesta, pdf);
  } finally {
    tiskarna.destroy();
  }
}

void app.whenReady().then(vytvorOkno);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) vytvorOkno();
});
