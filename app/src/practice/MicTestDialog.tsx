import { CheckCircle2, Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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

import type { Strike } from '../../../src/core/listen.js';
import { noteName } from './names.js';

export const TEST_CHORD = [60, 64, 67];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Subscribes to strikes while the dialog is open; returns the unsubscribe. */
  subscribe: (listener: (strike: Strike) => void) => () => void;
  /** Current input level in dBFS. */
  level: () => number;
}

/**
 * A quick check that the microphone hears the piano: play a C major chord a
 * few times and watch each of its notes light up. It also tells whether the
 * level is sensible before a whole piece is played into a deaf microphone.
 */
export function MicTestDialog({ open, onOpenChange, subscribe, level }: Props) {
  const [lit, setLit] = useState<number[]>([]);
  const [count, setCount] = useState<Record<number, number>>({});
  const meter = useRef<HTMLDivElement>(null);
  const [peak, setPeak] = useState(-120);

  useEffect(() => {
    if (!open) return;
    setCount({});
    setPeak(-120);
    const off = subscribe((strike) => {
      const heard = strike.notes.filter((n) => n.expected).map((n) => n.midi);
      if (heard.length === 0) return;
      setLit(heard);
      setCount((c) => {
        const next = { ...c };
        for (const m of heard) next[m] = (next[m] ?? 0) + 1;
        return next;
      });
      window.setTimeout(() => setLit([]), 500);
    });
    let frame = 0;
    let loudest = -120;
    const draw = (): void => {
      const db = level();
      loudest = Math.max(loudest - 0.3, db);
      if (meter.current) meter.current.style.width = `${Math.max(0, Math.min(1, (db + 70) / 60)) * 100}%`;
      setPeak((p) => (Math.abs(p - loudest) > 1 ? loudest : p));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [open, subscribe, level]);

  const reliable = TEST_CHORD.every((m) => (count[m] ?? 0) >= 2);
  const advice =
    peak < -55
      ? 'Mikrofon skoro nic neslyší — přibliž ho ke klavíru nebo zvyš vstupní hlasitost v systému.'
      : peak > -3
        ? 'Signál je na hraně přebuzení — mikrofon ztiš nebo dej dál.'
        : 'Hlasitost je v pořádku.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="size-5" aria-hidden /> Zkouška mikrofonu
          </DialogTitle>
          <DialogDescription>
            Zahraj několikrát akord C dur kolem středního C (C4, E4, G4). Každá nota, kterou aplikace
            uslyší, se rozsvítí.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="h-3 overflow-hidden rounded-full bg-muted" aria-label="Hlasitost na vstupu">
            <div ref={meter} className="h-full w-0 rounded-full bg-success transition-[width] duration-75" />
          </div>
          <p className="text-sm text-muted-foreground">{advice}</p>
        </div>

        <div className="flex justify-center gap-3 py-2">
          {TEST_CHORD.map((m) => (
            <div
              key={m}
              className={cn(
                'flex w-20 flex-col items-center gap-1 rounded-xl border py-3 transition-colors',
                lit.includes(m) && 'border-success bg-success/15',
              )}
            >
              <span className="text-xl font-semibold">{noteName(m)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{count[m] ?? 0}× slyšeno</span>
            </div>
          ))}
        </div>

        {reliable && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden /> Slyším spolehlivě. Můžeš hrát.
          </p>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Hotovo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
