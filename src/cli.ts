#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { writeMidi } from './core/midi.js';
import { writeMusicXml } from './core/notation.js';
import { printableHtml } from './core/print.js';
import { transcribeVideo, type TranscribeOptions } from './transcribe.js';

interface Flags {
  video: string;
  outDir: string;
  json: boolean;
  quiet: boolean;
  score: boolean;
  options: TranscribeOptions;
}

const HELP = `syn2notes — turns a video of a piano with falling bars into notation

  syn2notes <video> [flags]

  -o, --out <dir>          where to write the results (default: current dir)
      --bpm <number>       a fixed tempo instead of the estimate
      --time <4/4>         time signature
      --division <4>       smallest subdivision: 4 = sixteenths, 3 = triplets
      --first-midi <21>    MIDI number of the leftmost white key
      --threshold <0.12>   bar detection threshold, 0..1
      --min-frames <2>     shortest accepted note, in frames
      --merge-gap <1>      gaps of up to this many frames are merged
      --edges <a,b>        manual top and bottom edge of the keyboard, in pixels
      --neighbour <1.8>    how much stronger a neighbour drops a key as bleed
      --no-audio           do not compare against the audio track
      --score              also write a print-ready HTML of the engraved score
      --json               print the result as JSON on standard output
      --quiet              do not report progress
  -h, --help               this help

  Synthesia-style videos have crisp bar edges; for them try
  --min-frames 1 --merge-gap 0, which raises recall considerably.
`;

function parseArgs(argv: readonly string[]): Flags | null {
  const options: TranscribeOptions = { tempo: {}, detection: {}, keyboard: {} };
  let video = '';
  let outDir = '';
  let json = false;
  let quiet = false;
  let score = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`The flag ${a} expects a value.`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': return null;
      case '-o': case '--out': outDir = next(); break;
      case '--bpm': options.tempo!.bpm = Number(next()); break;
      case '--division': options.tempo!.division = Number(next()); break;
      case '--threshold': options.detection!.threshold = Number(next()); break;
      case '--min-frames': options.detection!.minFrames = Number(next()); break;
      case '--merge-gap': options.detection!.mergeGapFrames = Number(next()); break;
      case '--neighbour': options.detection!.neighbourRatio = Number(next()); break;
      case '--first-midi': options.keyboard!.firstMidi = Number(next()); break;
      case '--no-audio': options.withoutAudio = true; break;
      case '--score': score = true; break;
      case '--json': json = true; break;
      case '--quiet': quiet = true; break;
      case '--time': {
        const [numerator, denominator] = next().split('/');
        options.tempo!.numerator = Number(numerator);
        options.tempo!.denominator = Number(denominator ?? 4);
        break;
      }
      case '--edges': {
        const [top, bottom] = next().split(',');
        options.keyboard!.topEdge = Number(top);
        options.keyboard!.bottomEdge = Number(bottom);
        break;
      }
      default:
        if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
        video = a;
    }
  }

  if (!video) return null;
  return { video, outDir: outDir || '.', json, quiet, score, options };
}

/** Engraves the score and returns a self-contained printable HTML document. */
async function engrave(musicxml: string, title: string): Promise<string> {
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
  toolkit.loadData(musicxml);
  const pages: string[] = [];
  for (let i = 1; i <= toolkit.getPageCount(); i++) pages.push(toolkit.renderToSVG(i));
  return printableHtml(pages, { title });
}

async function main(): Promise<number> {
  let flags: Flags | null;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (!flags) {
    process.stdout.write(HELP);
    return 0;
  }

  const name = basename(flags.video, extname(flags.video));
  // Progress goes to standard error even with --json, so a caller can show what
  // is happening and still read the result from standard output.
  if (!flags.quiet) {
    flags.options.onStatus = (m) => process.stderr.write(`  ${m}\n`);
  }

  const result = await transcribeVideo(flags.video, flags.options);

  await mkdir(flags.outDir, { recursive: true });
  const midiPath = join(flags.outDir, `${name}.mid`);
  const musicxmlPath = join(flags.outDir, `${name}.musicxml`);
  const musicxml = writeMusicXml(result.notes, result.tempo, result.key.fifths, {
    title: name,
    splitPoint: result.splitPoint,
  });

  await writeFile(midiPath, writeMidi(result.notes, result.tempo, result.key.fifths, { title: name }));
  await writeFile(musicxmlPath, musicxml, 'utf8');

  let scorePath: string | null = null;
  if (flags.score) {
    scorePath = join(flags.outDir, `${name}.html`);
    await writeFile(scorePath, await engrave(musicxml, name), 'utf8');
  }

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          video: flags.video,
          midi: midiPath,
          musicxml: musicxmlPath,
          score: scorePath,
          keys: result.geometry.keys.length,
          frames: result.trace.frameCount,
          notes: result.notes.length,
          tempo: result.tempo,
          keySignature: result.key.fifths,
          threshold: Number(result.threshold.toFixed(3)),
          fallSpeed: Number.isFinite(result.fallSpeed) ? result.fallSpeed : null,
          octaveShift: result.octave.shift,
          audio: {
            offsetMs: Math.round(result.sync.offset * 1000),
            precision: Number(result.sync.precision.toFixed(2)),
            coverage: Number(result.sync.coverage.toFixed(2)),
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(`  written: ${midiPath}\n  written: ${musicxmlPath}\n`);
    if (scorePath) process.stderr.write(`  written: ${scorePath}\n`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    process.exit(1);
  },
);
