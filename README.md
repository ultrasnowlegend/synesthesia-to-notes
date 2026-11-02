# synesthesia-to-notes

Turns a video of a piano with falling synesthesia bars back into notation. Pitch
is read off the image rather than guessed: every frame shows which key is being
played. The audio only refines the timing of the strikes — and doubles as a
measure of confidence, because image and audio are independent sources.

Design and diagrams: [docs/architektura.html](docs/architektura.html) — still in Czech,
awaiting its own translation pass.

## The app

```
npm install
npm run build && npm run build:app
npm start
```

Drop in a video, let it transcribe, then adjust tempo, grid and legato with
sliders over a live preview of the score. Recomputing never touches the video
again, so it is instant. Exports MIDI, MusicXML and PDF.

Then **play from the score**: the score fills the window, the app listens
through a microphone or a MIDI keyboard, turns notes green as they are heard
and red when they are passed by, and turns lines of music by itself. One hand
can be practised with the app playing the other, a passage looped until it is
clean, the score listened to with a moving cursor, and the results show the
measures that keep going wrong. Any MusicXML, MXL, MEI, ABC or MIDI file can be
opened the same way. How the listening works and how well it was measured to
work: [docs/practice.md](docs/practice.md).

The window is built with Tailwind CSS and shadcn/ui (`app/src/components/ui`),
light and dark.

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
npm run build && npm test
```

The tests render their own video in the style this targets — a keyboard covered
by hands, bars fading out across it — and measure the whole chain against a
known truth. The listener is tested on a synthetic piano (stretched partials,
beating strings, the knock of the hammer); on real recordings it is measured by

```
node scripts/listen-bench.mjs <directory of C4.mp3-style samples> [--follow]
```

## Layout

- `src/core/` — pure logic, free of Node, ffmpeg and React; `listen.ts` and
  `follow.ts` are the live listener and the score follower
- `src/engrave.ts` — the score engraved for a screen, one line per page
- `src/video/`, `src/audio/` — calibration, the single pass over the video, onsets
- `src/cli.ts` — command line
- `app/` — the Electron window; only a shell over `src/`
