import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileMusic,
  Gauge,
  Music,
  Play,
  RefreshCw,
  ScanLine,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Hint } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/lib/theme';

import type { GridOptions, Summary, TranscribeInput } from '../../electron/shared.js';

interface Props {
  summary: Summary;
  grid: GridOptions;
  onGrid: (next: GridOptions) => void;
  onRerun: (input: TranscribeInput) => void;
  onNew: () => void;
  onPractice: () => void;
}

const DIVISIONS = [
  { value: 1, label: 'čtvrťové' },
  { value: 2, label: 'osminové' },
  { value: 3, label: 'osminové trioly' },
  { value: 4, label: 'šestnáctinové' },
  { value: 6, label: 'šestnáctinové trioly' },
];

const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '6/8', '5/4'];

function Field({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}): React.JSX.Element {
  // The score is redrawn when the thumb is let go, not on every pixel.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-semibold tabular-nums">
          {draft.toFixed(step < 1 ? 2 : 0)}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[draft]}
        onValueChange={([v]) => setDraft(v ?? value)}
        onValueCommit={([v]) => onChange(v ?? value)}
        aria-label={label}
      />
    </div>
  );
}

export function Result({ summary, grid, onGrid, onRerun, onNew, onPractice }: Props): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [svg, setSvg] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [edges, setEdges] = useState<[number, number]>([summary.topEdge, summary.bottomEdge]);
  const [firstMidi, setFirstMidi] = useState(summary.firstMidi);
  const [threshold, setThreshold] = useState(summary.threshold);

  useEffect(() => {
    let alive = true;
    void window.app.page(Math.min(page, Math.max(1, summary.pages))).then((r) => {
      if (alive && r.ok && r.data) setSvg(r.data);
    });
    return () => {
      alive = false;
    };
  }, [page, summary.pages, summary.notes, summary.tempo.bpm]);

  const save = async (kind: 'midi' | 'musicxml' | 'pdf'): Promise<void> => {
    setMessage(null);
    const r = await window.app.save(kind);
    if (r.ok && r.data) setMessage({ text: `Uloženo: ${r.data}`, ok: true });
    else if (!r.ok) setMessage({ text: r.error ?? 'Uložení se nepodařilo.', ok: false });
  };

  const agreement = Math.round(summary.sync.precision * 100);
  const fileName = summary.video.split(/[\\/]/).pop() ?? summary.video;
  const pages = Math.max(1, summary.pages);

  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5">
        <Hint label="Jiné video">
          <Button variant="ghost" size="icon" onClick={onNew} aria-label="Jiné video">
            <ArrowLeft />
          </Button>
        </Hint>
        <span className="max-w-72 truncate font-semibold" title={summary.video}>
          {fileName}
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          <Badge variant="secondary">{summary.keys} kláves</Badge>
          <Badge variant="secondary">{summary.events} not</Badge>
          <Badge variant="secondary">{summary.keyName}</Badge>
          <Hint label="Kolik úderů z obrazu sedí na údery ve zvuku — míra jistoty přepisu">
            <Badge variant={agreement >= 85 ? 'success' : agreement > 0 ? 'destructive' : 'secondary'}>
              shoda se zvukem {agreement} %
            </Badge>
          </Hint>
          <Badge variant="secondary">
            levá ruka {Math.round((summary.leftHandNotes / Math.max(1, summary.events)) * 100)} %
          </Badge>
          {summary.octaveShift !== 0 && <Badge variant="outline">oktáva opravena o {summary.octaveShift}</Badge>}
        </div>
        <ThemeToggle />
        <Button onClick={onPractice}>
          <Play aria-hidden /> Hrát z not
        </Button>
      </header>

      <div className="grid min-h-0 grid-cols-[22rem_1fr]">
        <aside className="space-y-4 overflow-y-auto border-r bg-card/50 p-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="size-4 text-primary" aria-hidden /> Mřížka
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 px-4">
              <Field
                label="Tempo"
                value={grid.bpm ?? summary.tempo.bpm}
                min={40}
                max={200}
                step={0.25}
                unit="BPM"
                onChange={(v) => onGrid({ ...grid, bpm: v })}
              />
              <Field
                label="Posun první doby"
                value={grid.offset ?? summary.tempo.offset}
                min={0}
                max={4}
                step={0.01}
                unit="s"
                onChange={(v) => onGrid({ ...grid, offset: v })}
              />
              <div className="grid grid-cols-[1fr_5.5rem] gap-3">
                <div className="space-y-2">
                  <Label>Dělení doby</Label>
                  <Select
                    value={String(grid.division ?? 4)}
                    onValueChange={(v) => onGrid({ ...grid, division: Number(v) })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIVISIONS.map((d) => (
                        <SelectItem key={d.value} value={String(d.value)}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Takt</Label>
                  <Select
                    value={`${grid.numerator ?? 4}/${grid.denominator ?? 4}`}
                    onValueChange={(v) => {
                      const [n, d] = v.split('/');
                      onGrid({ ...grid, numerator: Number(n), denominator: Number(d) });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SIGNATURES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Field
                label="Legato"
                value={grid.legato ?? 1}
                min={0}
                max={2}
                step={0.25}
                unit="doby"
                onChange={(v) => onGrid({ ...grid, legato: v })}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Legato vyplní krátké mezery prodlouženým tónem místo pomlky. Nula zachová naměřené délky
                doslova, což u improvizace vede na les pomlk.
              </p>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Music className="size-4 text-primary" aria-hidden /> Nalezené noty
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <img
                className="w-full rounded-md border [image-rendering:pixelated]"
                src={summary.rollPreview}
                alt="Klavírní rolka nalezených not"
              />
              <p className="text-xs text-muted-foreground">Celá nahrávka, zlatě pravá ruka, zeleně levá. Vodorovné linky jsou C.</p>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ScanLine className="size-4 text-primary" aria-hidden /> Kalibrace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <img
                className="w-full rounded-md border [image-rendering:pixelated]"
                src={summary.calibrationPreview}
                alt="Klaviatura s vyznačenými klávesami"
              />
              <p className="text-xs text-muted-foreground">
                Značky musí ležet na klávesách a fialové svislice u každého C. Když nesedí, zadej hrany ručně a
                přepočítej.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['top', 'Horní hrana', edges[0], (v: number) => setEdges([v, edges[1]])],
                    ['bottom', 'Dolní hrana', edges[1], (v: number) => setEdges([edges[0], v])],
                    ['first', 'Nejnižší bílá', firstMidi, setFirstMidi],
                  ] as const
                ).map(([id, label, value, set]) => (
                  <div key={id} className="space-y-1.5">
                    <Label htmlFor={id} className="text-xs">
                      {label}
                    </Label>
                    <Input id={id} type="number" value={value} onChange={(e) => set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
              <Field label="Práh detekce" value={threshold} min={0.05} max={0.5} step={0.01} onChange={setThreshold} />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() =>
                  onRerun({
                    keyboard: { topEdge: edges[0], bottomEdge: edges[1], firstMidi },
                    detection: { threshold },
                  })
                }
              >
                <RefreshCw aria-hidden /> Přepočítat z videa
              </Button>
            </CardContent>
          </Card>
        </aside>

        <section className="grid min-h-0 grid-rows-[1fr_auto] bg-stage">
          <div className="overflow-auto p-6">
            <div
              className="mx-auto w-full max-w-4xl rounded-md bg-paper shadow-xl ring-1 ring-black/5 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t bg-card px-4 py-2.5">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Předchozí strana">
                <ChevronLeft />
              </Button>
              <span className="px-2 text-sm tabular-nums text-muted-foreground">
                strana {Math.min(page, pages)} z {pages}
              </span>
              <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Další strana">
                <ChevronRight />
              </Button>
            </div>
            <div className="flex-1" />
            {message && (
              <span className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'} role="status">
                {message.text}
              </span>
            )}
            <Button variant="outline" onClick={() => void save('midi')}>
              <FileMusic aria-hidden /> MIDI
            </Button>
            <Button variant="outline" onClick={() => void save('musicxml')}>
              <FileMusic aria-hidden /> MusicXML
            </Button>
            <Button onClick={() => void save('pdf')}>
              <FileDown aria-hidden /> Uložit PDF
            </Button>
          </footer>
        </section>
      </div>
    </div>
  );
}
