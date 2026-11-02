import { useEffect, useImperativeHandle, useRef } from 'react';

export interface KeyboardHandle {
  /** Marks the keys the score waits for now. */
  expect: (midis: readonly number[]) => void;
  /** Lights a key up for a moment: green when it fitted, red when it did not. */
  flash: (midi: number, kind: 'ok' | 'wrong') => void;
  /** Marks the keys the demonstration is sounding now. */
  sounding: (midis: readonly number[]) => void;
}

const LOWEST = 21;
const HIGHEST = 108;
const BLACK = new Set([1, 3, 6, 8, 10]);

/**
 * A strip of all 88 keys under the score. It answers the two questions a
 * player has when the follower waits: which keys does it want, and what did
 * it actually hear.
 */
export function Keyboard({ ref }: { ref?: React.Ref<KeyboardHandle> }): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const keys = useRef(new Map<number, SVGRectElement>());
  const due = useRef<number[]>([]);
  const playing = useRef<number[]>([]);
  const timers = useRef(new Map<number, number>());

  useImperativeHandle(ref, () => ({
    expect: (midis) => {
      for (const m of due.current) keys.current.get(m)?.classList.remove('due');
      due.current = [...midis];
      for (const m of due.current) keys.current.get(m)?.classList.add('due');
    },
    sounding: (midis) => {
      for (const m of playing.current) keys.current.get(m)?.classList.remove('sounding');
      playing.current = [...midis];
      for (const m of playing.current) keys.current.get(m)?.classList.add('sounding');
    },
    flash: (midi, kind) => {
      const key = keys.current.get(midi);
      if (!key) return;
      key.classList.remove('flash-ok', 'flash-wrong');
      // Restart the animation even when the same key flashes twice in a row.
      void key.getBBox();
      key.classList.add(kind === 'ok' ? 'flash-ok' : 'flash-wrong');
      window.clearTimeout(timers.current.get(midi));
      timers.current.set(
        midi,
        window.setTimeout(() => key.classList.remove('flash-ok', 'flash-wrong'), 600),
      );
    },
  }));

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ns = 'http://www.w3.org/2000/svg';
    const whites: number[] = [];
    for (let m = LOWEST; m <= HIGHEST; m++) if (!BLACK.has(m % 12)) whites.push(m);
    const width = 1000 / whites.length;
    const blacks: SVGRectElement[] = [];
    whites.forEach((m, i) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(i * width));
      r.setAttribute('y', '0');
      r.setAttribute('width', String(width));
      r.setAttribute('height', '60');
      r.setAttribute('class', `key white${m % 12 === 0 ? ' c' : ''}`);
      svg.appendChild(r);
      keys.current.set(m, r);
      if (BLACK.has((m + 1) % 12) && m + 1 <= HIGHEST) {
        const b = document.createElementNS(ns, 'rect');
        b.setAttribute('x', String((i + 1) * width - width * 0.3));
        b.setAttribute('y', '0');
        b.setAttribute('width', String(width * 0.6));
        b.setAttribute('height', '38');
        b.setAttribute('class', 'key black');
        blacks.push(b);
        keys.current.set(m + 1, b);
      }
    });
    for (const b of blacks) svg.appendChild(b);
    const timersNow = timers.current;
    return () => {
      for (const t of timersNow.values()) window.clearTimeout(t);
      svg.replaceChildren();
      keys.current.clear();
    };
  }, []);

  return (
    <div className="piano-strip h-full">
      <svg ref={svgRef} viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true" />
    </div>
  );
}
