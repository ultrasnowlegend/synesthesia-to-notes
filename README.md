# synesthesia-to-notes

Turns a video of a piano with falling synesthesia bars back into notation. Pitch
is read off the image rather than guessed: every frame shows which key is being
played. The audio only refines the timing of the strikes — and doubles as a
measure of confidence, because image and audio are independent sources.

Design and diagrams: [docs/architecture.html](docs/architecture.html).

## The app

```
npm install
npm run build && npm run build:app
npm start
```

Drop in a video, let it transcribe, then adjust tempo, grid and legato with
sliders over a live preview of the score. Recomputing never touches the video
again, so it is instant. Exports MIDI, MusicXML and PDF.

For development `npm run dev` starts Vite and the Electron window together.

## Command line

```
npm run build
node dist/src/cli.js video.mp4 -o out/
```

Produces `.mid` and `.musicxml`; `--score` adds a print-ready HTML of the
engraved score. `node dist/src/cli.js --help` lists every flag.

With `--json` the result goes to standard output and the progress to standard
error, so the two can be read apart — that is exactly how the SuperSystem module
runs it.

Two smoothing constants are worth knowing about. The defaults are tuned for a
real piano, where the glow on a key is soft. Synthesia-style videos have crisp
bar edges and want `--min-frames 1 --merge-gap 0`; measured against a reference
MIDI that lifts recall from 86 % to 98 %.

Requires `ffmpeg` and `ffprobe` on the PATH, or paths in `FFMPEG_PATH` and
`FFPROBE_PATH`.

## Tests

```
npm run build && node --test dist/test/*.test.js
```

The tests render their own video in the style this targets — a keyboard covered
by hands, bars fading out across it — and measure the whole chain against a
known truth.

## Layout

- `src/core/` — pure logic, free of Node, ffmpeg and React
- `src/video/`, `src/audio/` — calibration, the single pass over the video, onsets
- `src/cli.ts` — command line
- `app/` — the Electron window; only a shell over `src/`
