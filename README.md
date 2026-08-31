# synesthesia-to-notes

Prevede video klaviru se synesthesia efekty zpet na notovy zapis. Vyska tonu se
z obrazu odecita, ne hada: v kazdem snimku je videt, kde je ktery padajici pruh.
Zvuk slouzi jen ke kontrole casu uderu — a zaroven jako mira duvery, protoze
obraz a zvuk jsou nezavisle zdroje.

Navrh vcetne diagramu: [docs/architektura.html](docs/architektura.html).

## Aplikace

```
npm install
npm run build && npm run build:app
npm start
```

Pretahnes video, aplikace ho prepise a ukaze noty. Tempo, mrizku a legato menis
posuvniky nad zivym nahledem — prepocet uz nesaha na video, takze je okamzity.
Exportuje MIDI, MusicXML a PDF.

Pro vyvoj staci `npm run dev`; spusti Vite i okno Electronu naraz.

## Prikazova radka

```
npm run build
node dist/src/cli.js video.mp4 -o vystup/
```

Vznikne `.mid` a `.musicxml`. Prepinace vypise `node dist/src/cli.js --help`.
S `--json` jde vysledek na standardni vystup a prubeh na chybovy, takze se daji
cist zvlast — presne tak si aplikaci pousti modul v SuperSystemu.

Vyzaduje `ffmpeg` a `ffprobe` v PATH, nebo cesty v `FFMPEG_PATH` a `FFPROBE_PATH`.

## Testy

```
npm run build && node --test dist/test/*.test.js
```

Testy si samy vygeneruji video ve stylu, o ktery jde — klaviatura zakryta
rukama, pruhy mizici pod ni — a meri cely retezec proti zname pravde.

## Struktura

- `src/jadro/` — cista logika bez Node, ffmpegu i Reactu
- `src/video/`, `src/audio/` — kalibrace, jediny pruchod videem, zvukove onsety
- `src/cli.ts` — prikazova radka
- `app/` — okno v Electronu; jen slupka nad `src/`
