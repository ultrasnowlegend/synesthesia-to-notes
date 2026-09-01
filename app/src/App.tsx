import { useCallback, useEffect, useRef, useState } from 'react';

import type { GridOptions, Summary, TranscribeInput } from '../electron/shared.js';
import { Intro } from './screens/Intro.js';
import { Progress } from './screens/Progress.js';
import { Result } from './screens/Result.js';

export type Screen = 'intro' | 'progress' | 'result';

const DEFAULT_GRID: GridOptions = { division: 4, numerator: 4, denominator: 4, legato: 1 };

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('intro');
  const [path, setPath] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [grid, setGrid] = useState<GridOptions>(DEFAULT_GRID);
  const [error, setError] = useState('');
  const manual = useRef<TranscribeInput>({});

  useEffect(() => window.app.onStatus((m) => setLines((r) => [...r, m])), []);

  const run = useCallback(
    async (file: string, input: TranscribeInput, nextGrid: GridOptions) => {
      manual.current = input;
      setPath(file);
      setLines([]);
      setError('');
      setScreen('progress');
      const reply = await window.app.transcribe(file, { ...input, ...nextGrid });
      if (reply.ok && reply.data) {
        // The estimated tempo becomes the starting value of the controls, so the
        // slider begins where the estimate ended and not at some constant.
        setGrid({ ...nextGrid, bpm: reply.data.tempo.bpm, offset: reply.data.tempo.offset });
        setSummary(reply.data);
        setScreen('result');
      } else {
        setError(reply.error ?? 'The transcription failed.');
        setScreen('intro');
      }
    },
    [],
  );

  const requantise = useCallback(async (next: GridOptions) => {
    setGrid(next);
    const reply = await window.app.requantise(next);
    if (reply.ok && reply.data) {
      // Previews are not resent on requantisation; keep the originals.
      setSummary((s) =>
        s
          ? {
              ...reply.data!,
              calibrationPreview: s.calibrationPreview,
              rollPreview: s.rollPreview,
            }
          : (reply.data ?? null),
      );
    }
  }, []);

  if (screen === 'progress') return <Progress path={path} lines={lines} />;
  if (screen === 'result' && summary) {
    return (
      <Result
        summary={summary}
        grid={grid}
        onGrid={requantise}
        onRerun={(input) => void run(path, input, grid)}
        onNew={() => setScreen('intro')}
      />
    );
  }
  return <Intro error={error} onVideo={(file) => void run(file, {}, DEFAULT_GRID)} />;
}
