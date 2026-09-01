import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMidi } from '../../src/core/midi.js';
import { writeMusicXml } from '../../src/core/notation.js';
import { drawCalibration, drawPianoRoll } from '../../src/core/previews.js';
import { printableHtml } from '../../src/core/print.js';
import { alignToStart, estimateTempo, quantise } from '../../src/core/tempo.js';
import { estimateKey } from '../../src/core/tonality.js';
import type { Note, NoteEvent } from '../../src/core/types.js';
import { transcribeVideo, type TranscribeOptions, type Transcription } from '../../src/transcribe.js';
import type { GridOptions, Reply, Summary } from './shared.js';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The main process keeps the found notes in memory, so changing the tempo, the
 * grid or the legato never touches the video or the colour trace and the score
 * is redrawn at once. That loop is the whole reason the trace is computed.
 */
let current: {
  path: string;
  result: Transcription;
  events: NoteEvent[];
  notes: Note[];
  musicxml: string;
} | null = null;

let window_: BrowserWindow | null = null;

function wrap<T, A extends unknown[]>(
  f: (...args: A) => Promise<T> | T,
): (...args: A) => Promise<Reply<T>> {
  return async (...args: A): Promise<Reply<T>> => {
    try {
      return { ok: true, data: await f(...args) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
}

const KEY_NAMES = [
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

function keyName(fifths: number): string {
  return KEY_NAMES[Math.max(0, Math.min(14, fifths + 7))] ?? '';
}

interface Engraver {
  loadData: (data: string) => boolean;
  getPageCount: () => number;
  renderToSVG: (page: number) => string;
  setOptions: (options: Record<string, unknown>) => void;
}

let engraver: Engraver | null = null;

async function getEngraver(): Promise<Engraver> {
  if (engraver) return engraver;
  const { default: createVerovioModule } = await import('verovio/wasm');
  const { VerovioToolkit } = await import('verovio/esm');
  const toolkit = new VerovioToolkit(await createVerovioModule());
  toolkit.setOptions({
    pageWidth: 2100,
    pageHeight: 2970,
    scale: 38,
    adjustPageHeight: false,
    footer: 'none',
    header: 'none',
    spacingStaff: 10,
  });
  engraver = toolkit as unknown as Engraver;
  return engraver;
}

function toDataUrl(rgb: Uint8Array, width: number, height: number): string {
  // nativeImage reads BGRA while we draw in RGB; converting is cheaper than
  // pulling a PNG encoder into the project.
  const bgra = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    bgra[j] = rgb[i * 3 + 2]!;
    bgra[j + 1] = rgb[i * 3 + 1]!;
    bgra[j + 2] = rgb[i * 3]!;
    bgra[j + 3] = 255;
  }
  return nativeImage.createFromBitmap(bgra, { width, height }).toDataURL();
}

function recompute(options: GridOptions): Summary {
  if (!current) throw new Error('A video has to be transcribed first.');
  const { result, events } = current;

  const tempo = estimateTempo(events, options);
  const notes = quantise(events, tempo, options);
  alignToStart(notes);
  const key = estimateKey(notes);
  const musicxml = writeMusicXml(notes, tempo, key.fifths, {
    title: basename(current.path, extname(current.path)),
    splitPoint: result.splitPoint,
    legato: options.legato,
  });

  current.notes = notes;
  current.musicxml = musicxml;

  const range = events.reduce(
    (r, e) => [Math.min(r[0], e.midi), Math.max(r[1], e.midi)] as [number, number],
    [127, 0] as [number, number],
  );

  return {
    video: current.path,
    duration: result.info.duration,
    fps: result.info.fps,
    frames: result.trace.frameCount,
    keys: result.geometry.keys.length,
    range,
    events: events.length,
    notes: notes.length,
    tempo,
    fifths: key.fifths,
    keyName: keyName(key.fifths),
    threshold: result.threshold,
    sync: result.sync,
    octaveShift: result.octave.shift,
    topEdge: result.geometry.topEdge,
    bottomEdge: result.geometry.bottomEdge,
    firstMidi: result.geometry.keys.find((k) => !k.black)?.midi ?? 21,
    leftHandNotes: events.filter((e) => e.hand === 'left').length,
    calibrationPreview: '',
    rollPreview: '',
    pages: 0,
  };
}

function createWindow(): void {
  window_ = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#12141a',
    title: 'Z videa zpět do not',
    webPreferences: {
      preload: fileURLToPath(new URL('preload.mjs', import.meta.url)),
      sandbox: false,
    },
  });

  if (process.env['VITE_DEV_SERVER_URL']) {
    void window_.loadURL(process.env['VITE_DEV_SERVER_URL']);
  } else {
    void window_.loadFile(`${here}../dist-app/index.html`);
  }
}

ipcMain.handle(
  'app:pick-video',
  wrap(async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vyber video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  }),
);

ipcMain.handle(
  'app:transcribe',
  wrap(async (_e: unknown, path: string, input: TranscribeOptions & GridOptions) => {
    const options: TranscribeOptions = {
      keyboard: input.keyboard ?? {},
      detection: input.detection ?? {},
      onStatus: (m) => window_?.webContents.send('app:status', m),
    };
    const result = await transcribeVideo(path, options);
    current = { path, result, events: result.events, notes: result.notes, musicxml: '' };

    const summary = recompute(input);
    const calibration = drawCalibration(result.geometry, result.background);
    summary.calibrationPreview = toDataUrl(
      calibration.data,
      calibration.width,
      calibration.height,
    );
    const roll = drawPianoRoll(result.events, result.info.duration);
    summary.rollPreview = toDataUrl(roll.data, roll.width, roll.height);
    const toolkit = await getEngraver();
    summary.pages = toolkit.loadData(current.musicxml) ? toolkit.getPageCount() : 0;
    return summary;
  }),
);

ipcMain.handle(
  'app:requantise',
  wrap(async (_e: unknown, options: GridOptions) => {
    const summary = recompute(options);
    const toolkit = await getEngraver();
    summary.pages = toolkit.loadData(current!.musicxml) ? toolkit.getPageCount() : 0;
    return summary;
  }),
);

ipcMain.handle(
  'app:page',
  wrap(async (_e: unknown, number: number) => (await getEngraver()).renderToSVG(number)),
);

ipcMain.handle(
  'app:save',
  wrap(async (_e: unknown, kind: 'midi' | 'musicxml' | 'pdf') => {
    if (!current) throw new Error('There is nothing to save.');
    const base = basename(current.path, extname(current.path));
    const extension = kind === 'midi' ? 'mid' : kind === 'musicxml' ? 'musicxml' : 'pdf';
    const r = await dialog.showSaveDialog({
      defaultPath: `${base}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (r.canceled || !r.filePath) return null;

    if (kind === 'midi') {
      const key = estimateKey(current.notes);
      await writeFile(
        r.filePath,
        writeMidi(current.notes, current.result.tempo, key.fifths, { title: base }),
      );
    } else if (kind === 'musicxml') {
      await writeFile(r.filePath, current.musicxml, 'utf8');
    } else {
      await savePdf(r.filePath, base);
    }
    return r.filePath;
  }),
);

ipcMain.handle(
  'app:reveal',
  wrap((_e: unknown, path: string) => shell.showItemInFolder(path)),
);

/**
 * The PDF is printed from a hidden window. Verovio has already engraved the
 * score into SVG, so the pages only need stacking; a second layout engine would
 * be pointless.
 */
async function savePdf(path: string, title: string): Promise<void> {
  const toolkit = await getEngraver();
  const pages: string[] = [];
  for (let i = 1; i <= toolkit.getPageCount(); i++) pages.push(toolkit.renderToSVG(i));

  // The page is loaded from a file rather than a data: URL. An engraved score is
  // hundreds of kilobytes of SVG per page and such a URL exceeds the length
  // Chromium accepts, ending in ERR_INVALID_URL.
  const temporary = join(tmpdir(), `syn2notes-print-${randomBytes(6).toString('hex')}.html`);
  await writeFile(temporary, printableHtml(pages, { title }), 'utf8');

  const printer = new BrowserWindow({ show: false });
  try {
    await printer.loadFile(temporary);
    const pdf = await printer.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await writeFile(path, pdf);
  } finally {
    printer.destroy();
    await rm(temporary, { force: true });
  }
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
