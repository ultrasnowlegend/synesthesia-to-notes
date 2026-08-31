# synesthesia-to-notes

Prevede video klaviru se synesthesia efekty zpet na notovy zapis. Vyska tonu se
z obrazu odecita, ne hada: v kazdem snimku je videt, kde je ktery padajici pruh.

Navrh vcetne diagramu: [docs/architektura.html](docs/architektura.html).

## Pouziti

```
npm install
npm run build
node dist/src/cli.js video.mp4 -o vystup/
```

Vznikne `.mid` a `.musicxml`. Prepinace vypise `node dist/src/cli.js --help`.

Vyzaduje `ffmpeg` a `ffprobe` v PATH, nebo cesty v `FFMPEG_PATH` a `FFPROBE_PATH`.

## Testy

```
npm run build && node --test dist/test/*.test.js
```

Testy si samy vygeneruji video ve stylu, o ktery jde — klaviatura zakryta
rukama, pruhy mizici pod ni — a meri cely retezec proti znamé pravdě.

## Struktura

- `src/jadro/` — cista logika bez Node, ffmpegu i Reactu
- `src/video/` — kalibrace a jediny pruchod videem pres ffmpeg
- `src/cli.ts` — prikazova radka
