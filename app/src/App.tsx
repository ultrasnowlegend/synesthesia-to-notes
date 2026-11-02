import { useCallback, useEffect, useRef, useState } from 'react';

import type { GridOptions, Summary, TranscribeInput } from '../electron/shared.js';
import { rememberScore } from './practice/history.js';
import { Intro } from './screens/Intro.js';
import { Practice } from './screens/Practice.js';
import { Progress } from './screens/Progress.js';
import { Result } from './screens/Result.js';

export type Screen = 'intro' | 'progress' | 'result' | 'practice';

const DEFAULT_GRID: GridOptions = { division: 4, numerator: 4, denominator: 4, legato: 1 };

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('intro');
  const [path, setPath] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [grid, setGrid] = useState<GridOptions>(DEFAULT_GRID);
  const [error, setError] = useState('');
  const [practiceTitle, setPracticeTitle] = useState('');
  const [returnTo, setReturnTo] = useState<Screen>('intro');
  const manual = useRef<TranscribeInput>({});

  useEffect(() => {
    const off = window.app.onStatus((m) => setLines((r) => [...r, m]));
    return off;
  }, []);

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

  const openScore = useCallback(async (file?: string) => {
    const reply = await window.app.openScore(file);
    if (reply.ok && reply.data) {
      if (reply.data.path) rememberScore(reply.data.path, reply.data.title);
      setError('');
      setPracticeTitle(reply.data.title);
      setReturnTo('intro');
      setScreen('practice');
    } else if (!reply.ok) {
      setError(reply.error ?? 'Noty se nepodařilo otevřít.');
    }
  }, []);

  const openDemo = useCallback(async () => {
    const reply = await window.app.practiceDemo();
    if (reply.ok && reply.data) {
      setPracticeTitle(reply.data.title);
      setReturnTo('intro');
      setScreen('practice');
    }
  }, []);

  const practiseCurrent = useCallback(async () => {
    const reply = await window.app.practiceCurrent();
    if (reply.ok && reply.data) {
      setPracticeTitle(reply.data.title);
      setReturnTo('result');
      setScreen('practice');
    }
  }, []);

  if (screen === 'practice') {
    return (
      <Practice
        title={practiceTitle}
        onBack={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          setScreen(returnTo === 'result' && summary ? 'result' : 'intro');
        }}
      />
    );
  }
  if (screen === 'progress') return <Progress path={path} lines={lines} />;
  if (screen === 'result' && summary) {
    return (
      <Result
        summary={summary}
        grid={grid}
        onGrid={requantise}
        onRerun={(input) => void run(path, input, grid)}
        onNew={() => setScreen('intro')}
        onPractice={() => void practiseCurrent()}
      />
    );
  }
  return (
    <Intro
      error={error}
      onVideo={(file) => void run(file, {}, DEFAULT_GRID)}
      onScore={(file) => void openScore(file)}
      onDemo={() => void openDemo()}
    />
  );
}
