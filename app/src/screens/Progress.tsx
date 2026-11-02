import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress as Bar } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface Props {
  path: string;
  lines: string[];
}

/** The stages of a transcription, recognised by how their status messages begin. */
const STAGES: [RegExp, string][] = [
  [/^reading video metadata/, 'Čtu údaje o videu'],
  [/^calibrating|^found \d+ keys/, 'Hledám klaviaturu'],
  [/^reading the video|^processed/, 'Procházím snímky'],
  [/^looking for notes|^found \d+ notes/, 'Hledám noty'],
  [/^tracking the hands/, 'Sleduji ruce'],
  [/^comparing with the audio|^audio:|^octave/, 'Porovnávám se zvukem'],
  [/^estimating tempo|^tempo/, 'Určuji tempo a tóninu'],
];

export function Progress({ path, lines }: Props): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer Chromium returns a promise from scrollIntoView, and
    // React would take a returned promise for a clean-up function.
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  let reached = 0;
  for (const line of lines) {
    STAGES.forEach(([pattern], i) => {
      if (pattern.test(line)) reached = Math.max(reached, i);
    });
  }
  const name = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden /> Přepisuji…
          </CardTitle>
          <CardDescription className="truncate" title={path}>
            {name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Bar value={((reached + 0.5) / STAGES.length) * 100} aria-label="Postup přepisu" />
          <ol className="space-y-2">
            {STAGES.map(([, label], i) => (
              <li key={label} className={cn('flex items-center gap-2.5 text-sm', i > reached && 'text-muted-foreground')}>
                {i < reached ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                ) : i === reached ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                ) : (
                  <Circle className="size-4" aria-hidden />
                )}
                {label}
              </li>
            ))}
          </ol>
          <details className="rounded-lg border bg-muted/40 text-xs">
            <summary className="cursor-pointer px-3 py-2 text-muted-foreground">Podrobný záznam</summary>
            <div className="max-h-48 overflow-y-auto px-3 pb-3 font-mono leading-relaxed">
              {lines.map((line, i) => (
                <div key={i} className={cn(i === lines.length - 1 && 'text-primary')}>
                  {line}
                </div>
              ))}
              <div ref={end} />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
