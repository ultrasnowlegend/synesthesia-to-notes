import {
  AudioLines,
  Clock,
  FileMusic,
  Film,
  Music4,
  Palette,
  Repeat,
  ScrollText,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { forgetScore, recentScores, type Recent } from '../practice/history.js';

interface Props {
  error: string;
  onVideo: (path: string) => void;
  onScore: (path?: string) => void;
  onDemo: () => void;
}

const SCORE_EXTENSIONS = /\.(musicxml|xml|mxl|mei|mid|midi|abc)$/i;

const FEATURES = [
  { icon: AudioLines, title: 'Poslouchá', text: 'mikrofon u klavíru nebo MIDI z digitálního piana' },
  { icon: Palette, title: 'Barví noty', text: 'zelená zahraná, červená vynechaná, kurzor na další' },
  { icon: ScrollText, title: 'Otáčí sama', text: 'po řádcích, po stránkách nebo plynule; i pedálem' },
  { icon: Repeat, title: 'Procvičuje', text: 'smyčka, ukázka, jedna ruka a místa, kde to drhne' },
];

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'právě teď';
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'včera' : `před ${days} dny`;
}

export function Intro({ error, onVideo, onScore, onDemo }: Props): React.JSX.Element {
  const [overZone, setOverZone] = useState(false);
  const [recent, setRecent] = useState<Recent[]>(recentScores);

  const pick = async (): Promise<void> => {
    const reply = await window.app.pickVideo();
    if (reply.ok && reply.data) onVideo(reply.data);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-6">
        <header className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Music4 className="size-5" aria-hidden />
          </div>
          <span className="font-semibold">synesthesia → noty</span>
          <div className="flex-1" />
          <ThemeToggle />
        </header>

        <section className="mt-10 mb-8 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-balance">Z videa zpět do not — a pak z nich rovnou hraj</h1>
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground text-pretty">
            Nahrávka klavíru s padajícími pruhy v sobě noty už má, jen v obraze. Aplikace je přepíše do
            zápisu a při hraní tě poslouchá: barví zahrané noty a otáčí stránky za tebe.
          </p>
        </section>

        {error && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Film className="size-5 text-primary" aria-hidden /> Přepsat video
              </CardTitle>
              <CardDescription>Video klavíru s efekty Synthesia → MIDI, MusicXML a PDF.</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                  overZone ? 'border-primary bg-primary/10' : 'border-border',
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverZone(true);
                }}
                onDragLeave={() => setOverZone(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverZone(false);
                  const file = e.dataTransfer.files[0];
                  if (!file) return;
                  // Scores dropped here open for playing; anything else is a video.
                  if (SCORE_EXTENSIONS.test(file.name)) onScore(window.app.filePath(file));
                  else onVideo(window.app.filePath(file));
                }}
              >
                <p className="text-sm text-muted-foreground">Přetáhni sem video nebo noty</p>
                <Button size="lg" onClick={() => void pick()}>
                  <Film aria-hidden /> Vybrat video…
                </Button>
                <p className="text-xs text-muted-foreground">MP4, MOV, MKV, WebM, AVI</p>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileMusic className="size-5 text-primary" aria-hidden /> Hrát z not
              </CardTitle>
              <CardDescription>MusicXML, MXL, MEI, ABC nebo MIDI — třeba z MuseScore.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <Button variant="secondary" size="lg" className="w-full" onClick={() => onScore()}>
                <FileMusic aria-hidden /> Otevřít noty…
              </Button>
              {recent.length > 0 ? (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden /> Naposledy
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {recent.slice(0, 5).map((r) => (
                      <li key={r.path} className="group flex items-center gap-2 pr-1">
                        <button
                          className="flex min-w-0 flex-1 items-baseline gap-2 rounded-l-lg px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          onClick={() => onScore(r.path)}
                          title={r.path}
                        >
                          <span className="truncate font-medium">{r.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{ago(r.at)}</span>
                        </button>
                        <Hint label="Odebrat ze seznamu">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Odebrat ${r.title} ze seznamu`}
                            className="opacity-60 group-hover:opacity-100"
                            onClick={() => {
                              forgetScore(r.path);
                              setRecent(recentScores());
                            }}
                          >
                            <X />
                          </Button>
                        </Hint>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nebo nejdřív přepiš video — z výsledku se dá hrát rovnou.
                </p>
              )}
              <Button variant="link" className="mt-auto self-start px-0" onClick={onDemo}>
                <Sparkles aria-hidden /> Vyzkoušet na ukázce (Óda na radost)
              </Button>
            </CardContent>
          </Card>
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
