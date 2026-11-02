import { Repeat, RotateCcw, Trophy, TrendingDown, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { accuracy, type Run } from './history.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: Run | null;
  runs: Run[];
  onAgain: () => void;
  onPractise: (measure: number) => void;
}

/** Medal tiers after Piano Marvel: a clear target above the bare percentage. */
function medal(score: number): { label: string; tone: string } | null {
  if (score >= 100) return { label: 'Bez chyby', tone: 'bg-primary/20 text-primary' };
  if (score >= 96) return { label: 'Zlato', tone: 'bg-yellow-400/20 text-yellow-500' };
  if (score >= 90) return { label: 'Stříbro', tone: 'bg-slate-300/20 text-slate-300' };
  if (score >= 80) return { label: 'Bronz', tone: 'bg-orange-400/20 text-orange-400' };
  return null;
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/** The end of a run: how it went, how it compares, and where to practise next. */
export function ResultsDialog({ open, onOpenChange, run, runs, onAgain, onPractise }: Props) {
  if (!run) return null;
  const score = accuracy(run);
  const earlier = runs.slice(0, -1);
  const previous = earlier[earlier.length - 1];
  const best = earlier.length > 0 ? Math.max(...earlier.map(accuracy)) : null;
  const delta = previous ? score - accuracy(previous) : null;
  const recent = runs.slice(-12);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {best !== null && score > best && <Trophy className="size-5 text-primary" aria-hidden />}
            Dohráno
          </DialogTitle>
          <DialogDescription>
            {best !== null && score > best
              ? 'Nejlepší výsledek u této skladby.'
              : 'Takhle dopadl tenhle průchod skladbou.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-5xl font-bold tabular-nums tracking-tight">{score} %</span>
              {medal(score) && (
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', medal(score)!.tone)}>
                  {medal(score)!.label}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">přesnost</div>
          </div>
          {delta !== null && (
            <Badge variant={delta >= 0 ? 'success' : 'destructive'} className="mb-2 text-sm">
              {delta >= 0 ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}
              {delta >= 0 ? '+' : ''}
              {delta} % oproti minule
            </Badge>
          )}
          {recent.length > 1 && (
            <div className="ml-auto flex h-14 items-end gap-1" aria-label="Přesnost posledních průchodů">
              {recent.map((r, i) => (
                <div
                  key={r.at}
                  title={`${accuracy(r)} %`}
                  className={cn(
                    'w-2.5 rounded-sm bg-muted-foreground/40',
                    i === recent.length - 1 && 'bg-primary',
                  )}
                  style={{ height: `${Math.max(6, accuracy(r))}%` }}
                />
              ))}
            </div>
          )}
        </div>

        {(run.unsure ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            {run.unsure} not v akordech mikrofon neodlišil jednotlivě — nepočítají se ani jako zahrané, ani
            jako chyba.
          </p>
        )}
        <dl className="grid grid-cols-4 gap-3 text-center">
          {[
            ['zahráno', `${run.hit} / ${run.total}`, 'text-success'],
            ['vynecháno', String(run.missed), run.missed > 0 ? 'text-destructive' : ''],
            ['chyby', String(run.wrong), run.wrong > 0 ? 'text-destructive' : ''],
            ['čas', duration(run.seconds), ''],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-lg border bg-card px-2 py-3">
              <dd className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</dd>
              <dt className="text-xs text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>

        {run.trouble.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Kde to drhne</h3>
            <ul className="space-y-1.5">
              {run.trouble.slice(0, 3).map((t) => (
                <li key={t.measure} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="font-medium">Takt {t.measure}</span>
                  <span className="text-muted-foreground">
                    {t.mistakes} {t.mistakes === 1 ? 'chyba' : t.mistakes < 5 ? 'chyby' : 'chyb'}
                  </span>
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => onPractise(t.measure)}>
                    <Repeat aria-hidden />
                    Procvičit ve smyčce
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Zavřít
          </Button>
          <Button onClick={onAgain}>
            <RotateCcw aria-hidden />
            Znovu od začátku
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
