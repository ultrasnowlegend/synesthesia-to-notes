import {
  ArrowLeft,
  CircleHelp,
  EarOff,
  Keyboard as KeyboardIcon,
  Maximize,
  Mic,
  Minimize,
  Moon,
  Pause,
  Piano,
  Play,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  ScoreFollower,
  type FollowChange,
  type FollowStats,
  type InputKind,
  type ScoreStep,
} from '../../../src/core/follow.js';
import { NoteListener, type Strike } from '../../../src/core/listen.js';
import { lineSlots, pageStart, type TurnMode } from '../../../src/core/turning.js';
import type { PracticeLayout } from '../../electron/shared.js';
import { addRun, accuracy, runsOf, type Run } from '../practice/history.js';
import { Keyboard, type KeyboardHandle } from '../practice/Keyboard.js';
import { MicTestDialog, TEST_CHORD } from '../practice/MicTestDialog.js';
import { MidiKeyboard } from '../practice/midi.js';
import { Microphone, type AudioDevice } from '../practice/microphone.js';
import { noteName } from '../practice/names.js';
import { ScorePlayer } from '../practice/player.js';
import { ResultsDialog } from '../practice/ResultsDialog.js';
import { ShortcutsDialog } from '../practice/ShortcutsDialog.js';

type Input = 'none' | 'microphone' | 'midi';
type Hands = 'both' | 'right' | 'left';
type Sensitivity = 'low' | 'medium' | 'high';

interface Props {
  title: string;
  onBack: () => void;
}

interface Settings {
  input: Input;
  device: string;
  hands: Hands;
  mode: TurnMode;
  scale: number;
  sensitivity: Sensitivity;
  night: boolean;
  keyboard: boolean;
  accompany: boolean;
  speed: number;
}

const DEFAULTS: Settings = {
  input: 'microphone',
  device: '',
  hands: 'both',
  mode: 'lines',
  scale: 50,
  sensitivity: 'medium',
  night: false,
  keyboard: true,
  accompany: true,
  speed: 1,
};

const THRESHOLDS: Record<Sensitivity, number> = { low: 0.42, medium: 0.32, high: 0.25 };

/** A loop pass this accurate counts as clean. */
const CLEAN = 90;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('practice-settings');
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Settings are a convenience; without them the defaults do.
  }
  return DEFAULTS;
}

const now = (): number => performance.now() / 1000;

/** Staves played with the chosen hands; the top staff is the right hand. */
function stavesFor(hands: Hands, staves: number[]): number[] {
  if (hands === 'both' || staves.length < 2) return [];
  return hands === 'right' ? [staves[0]!] : staves.slice(1);
}

function inputKind(input: Input): InputKind {
  return input === 'microphone' ? 'audio' : 'midi';
}

interface Loop {
  /** First and last measure, numbered from 0. */
  from: number;
  to: number;
}

interface Drawn {
  systems: HTMLDivElement[];
  notes: Map<string, Element>;
  measureEls: (Element | null)[];
  stepOf: Map<string, number>;
  firstStepOf: number[];
  current: string[];
  playback: string[];
  cursor: HTMLDivElement;
  bands: HTMLDivElement[];
}

/**
 * Playing from the score: the engraved score cut to the window, a finger on
 * the step due now, notes turning green when heard and red when passed by,
 * lines of music turned without a hand — plus a demonstration to listen to,
 * a loop for drilling a passage and a record of where it keeps going wrong.
 *
 * The score is drawn and recoloured outside React: a few thousand SVG nodes
 * that change one at a time are no work for the DOM and a lot for a virtual one.
 */
export function Practice({ title, onBack }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [layout, setLayout] = useState<PracticeLayout | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [stats, setStats] = useState<FollowStats>({ hit: 0, missed: 0, unsure: 0, wrong: 0, total: 0 });
  const [heard, setHeard] = useState('');
  const [measure, setMeasure] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<Loop | null>(null);
  const [passes, setPasses] = useState<number[]>([]);
  const [result, setResult] = useState<{ run: Run; runs: Run[] } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [micTestOpen, setMicTestOpen] = useState(false);
  const [scaleDraft, setScaleDraft] = useState(settings.scale);

  const scoreRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<KeyboardHandle>(null);
  const followerRef = useRef<ScoreFollower | null>(null);
  const listenerRef = useRef<NoteListener | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const midiRef = useRef<MidiKeyboard | null>(null);
  const playerRef = useRef<ScorePlayer>(new ScorePlayer());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const drawn = useRef<Drawn | null>(null);
  /** What the screen shows: the first line of a page, or a line looked ahead to by hand. */
  const view = useRef<{ start: number; manual: number | null }>({ start: 0, manual: null });
  /** The step the demonstration is sounding; while set, it drives the view. */
  const playbackStep = useRef<number | null>(null);
  /** Where the finger was before the last change, for the accompaniment. */
  const lastPosition = useRef(0);
  /** Pitches the app itself sounded and when, so the microphone ignores them. */
  const ownSound = useRef(new Map<number, number>());
  /** When this run began, for the time spent. */
  const runStart = useRef<number | null>(null);
  /** Whether the end of this run has been reported already. */
  const reported = useRef(false);
  const testListener = useRef<((strike: Strike) => void) | null>(null);

  const update = (patch: Partial<Settings>): void => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem('practice-settings', JSON.stringify(next));
      } catch {
        // Not remembered this time.
      }
      return next;
    });
  };

  // ---------------------------------------------------------------- layout

  const requestLayout = useCallback(async () => {
    const el = scoreRef.current;
    if (!el) return;
    const width = Math.max(320, el.clientWidth - 6);
    const reply = await window.app.practiceLayout(width, settingsRef.current.scale);
    if (reply.ok && reply.data) {
      setLayout(reply.data);
      setError('');
    } else {
      setError(reply.error ?? 'Noty se nepodařilo vysázet.');
    }
  }, []);

  useEffect(() => {
    void requestLayout();
  }, [requestLayout, settings.scale]);

  useEffect(() => {
    let timer = 0;
    let lastWidth = scoreRef.current?.clientWidth ?? 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const width = scoreRef.current?.clientWidth ?? 0;
        if (Math.abs(width - lastWidth) > 8) {
          lastWidth = width;
          void requestLayout();
        } else {
          placeView();
        }
      }, 200);
    });
    if (scoreRef.current) observer.observe(scoreRef.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // placeView reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestLayout]);

  // ------------------------------------------------------- drawing the score

  const colour = (id: string): void => {
    const el = drawn.current?.notes.get(id);
    const f = followerRef.current;
    if (!el || !f) return;
    const state = f.state(id);
    el.classList.toggle('st-hit', state === 'hit');
    el.classList.toggle('st-missed', state === 'missed');
    el.classList.toggle('st-skipped', state === 'skipped');
    el.classList.toggle('st-unsure', state === 'unsure');
  };

  const colourAll = (): void => {
    const d = drawn.current;
    if (!d) return;
    for (const id of d.notes.keys()) colour(id);
  };

  /** The step the view follows: the demonstration's while it plays, else the player's. */
  const focusStep = (): ScoreStep | undefined => {
    const f = followerRef.current;
    if (!f) return undefined;
    if (playbackStep.current !== null) return f.steps[playbackStep.current];
    return f.current ?? f.steps[f.steps.length - 1];
  };

  const currentSystem = (): number => {
    const d = drawn.current;
    if (!d) return 0;
    return Math.min(d.systems.length - 1, focusStep()?.system ?? 0);
  };

  /** How far through its line the player is, 0..1. */
  const progress = (): number => {
    const f = followerRef.current;
    const d = drawn.current;
    if (!f || !d) return 0;
    const system = currentSystem();
    const first = d.firstStepOf[system] ?? 0;
    const next = d.firstStepOf[system + 1] ?? f.steps.length;
    const at = playbackStep.current ?? f.position;
    return next > first ? (at - first) / (next - first) : 0;
  };

  /** Tints the measures of the loop on the lines that are on screen. */
  const placeBands = (): void => {
    const d = drawn.current;
    if (!d) return;
    for (const b of d.bands) b.remove();
    d.bands = [];
    const range = loopRef.current;
    for (const s of d.systems) s.classList.remove('in-loop');
    if (!range) return;
    for (let m = range.from; m <= range.to; m++) {
      const el = d.measureEls[m];
      const system = el?.closest<HTMLDivElement>('div.system');
      if (!el || !system || !system.isConnected) continue;
      const box = system.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const band = document.createElement('div');
      band.className =
        'pointer-events-none absolute top-1 bottom-1 rounded-sm bg-sky-400/12 ring-1 ring-sky-500/35';
      band.style.left = `${r.left - box.left}px`;
      band.style.width = `${r.width}px`;
      system.appendChild(band);
      d.bands.push(band);
    }
  };

  const placeCursor = (): void => {
    const d = drawn.current;
    const f = followerRef.current;
    if (!d || !f) return;
    for (const id of d.current) d.notes.get(id)?.classList.remove('st-current');
    const step = playbackStep.current === null ? f.current : undefined;
    d.current = step ? step.notes.filter((n) => f.state(n.id) === 'pending').map((n) => n.id) : [];
    for (const id of d.current) d.notes.get(id)?.classList.add('st-current');

    const target = focusStep();
    const system = target ? d.systems[target.system] : undefined;
    if (!target || !system || !system.isConnected || (f.finished && playbackStep.current === null)) {
      d.cursor.style.display = 'none';
      return;
    }
    const box = system.getBoundingClientRect();
    let left = Infinity;
    let right = -Infinity;
    for (const n of target.notes) {
      const r = d.notes.get(n.id)?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      left = Math.min(left, r.left - box.left);
      right = Math.max(right, r.right - box.left);
    }
    if (!Number.isFinite(left)) {
      d.cursor.style.display = 'none';
      return;
    }
    if (d.cursor.parentElement !== system) system.appendChild(d.cursor);
    d.cursor.style.display = 'block';
    d.cursor.style.left = `${left - 6}px`;
    d.cursor.style.width = `${right - left + 12}px`;
  };

  /** Puts the right lines of music on screen for the mode and the position. */
  const placeView = (): void => {
    const d = drawn.current;
    const el = scoreRef.current;
    if (!d || !el || d.systems.length === 0) return;
    const mode = settingsRef.current.mode;
    const total = d.systems.length;
    const height = el.clientHeight;
    const active = currentSystem();
    const line = view.current.manual ?? active;
    const heights = d.systems.map((s) => s.offsetHeight || Number(s.dataset['height'] ?? 200));

    el.classList.toggle('overflow-y-auto', mode === 'scroll');
    el.classList.toggle('overflow-hidden', mode !== 'scroll');
    if (mode === 'scroll') {
      if (el.childElementCount !== total || el.firstElementChild !== d.systems[0]) el.replaceChildren(...d.systems);
      for (const s of d.systems) s.classList.remove('is-playing', 'is-next');
      d.systems[active]?.classList.add('is-playing');
      const target = d.systems[line];
      if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - height * 0.12), behavior: 'smooth' });
      placeCursor();
      placeBands();
      return;
    }

    let shown: number[];
    if (mode === 'lines') {
      const tallest = Math.max(...heights);
      shown = lineSlots(line, Math.max(1, Math.floor(height / tallest)), total);
    } else {
      const fits = (start: number): number => {
        let used = 0;
        let count = 0;
        for (let i = start; i < total; i++) {
          used += heights[i]!;
          if (used > height && count > 0) break;
          count++;
        }
        return Math.max(1, count);
      };
      const start = pageStart(view.current.start, line, view.current.manual === null ? progress() : 0, fits, total);
      view.current.start = start;
      shown = [];
      for (let i = start; i < start + fits(start); i++) shown.push(i);
    }

    const wanted = shown.map((i) => (i >= 0 ? d.systems[i]! : null));
    const children = [...el.children];
    const same = children.length === wanted.length && wanted.every((w, i) => w !== null && children[i] === w);
    if (!same) {
      el.replaceChildren(
        ...wanted.map((w) => {
          if (w) return w;
          const empty = document.createElement('div');
          empty.className = 'slot-empty';
          return empty;
        }),
      );
    }
    for (const s of d.systems) s.classList.remove('is-playing', 'is-next', 'wraps');
    d.systems[active]?.classList.add('is-playing');
    // In "lines" the reading continues from the bottom back to the top; the
    // line that comes after the one being played is marked so the eye finds it.
    if (mode === 'lines' && active + 1 < total) {
      const next = d.systems[active + 1];
      next?.classList.add('is-next');
      if (next && shown.indexOf(active + 1) < shown.indexOf(active)) next.classList.add('wraps');
    }
    el.scrollTop = 0;
    placeCursor();
    placeBands();
  };

  const refreshStats = (): void => {
    const f = followerRef.current;
    if (!f) return;
    setStats(f.stats());
    setMeasure((focusStep()?.measure ?? 0) + 1);
    keyboardRef.current?.expect(f.expected().due);
  };

  // ------------------------------------------------- loops, runs and results

  const loopSteps = (range: Loop): [number, number] => {
    const steps = followerRef.current?.steps ?? [];
    let first = steps.findIndex((s) => (s.measure ?? 0) >= range.from);
    if (first < 0) first = 0;
    let last = steps.length - 1;
    while (last > first && (steps[last]!.measure ?? 0) > range.to) last--;
    return [first, last];
  };

  const finishRun = (): void => {
    const f = followerRef.current;
    const l = layoutRef.current;
    if (!f || !l) return;
    const s = f.stats();
    if (s.hit + s.missed === 0) return;
    const trouble = f
      .byMeasure()
      .map((m) => ({ measure: m.measure + 1, mistakes: m.missed + m.wrong }))
      .filter((m) => m.mistakes > 0)
      .sort((a, b) => b.mistakes - a.mistakes)
      .slice(0, 5);
    const run: Run = {
      at: Date.now(),
      ...s,
      seconds: runStart.current === null ? 0 : now() - runStart.current,
      hands: settingsRef.current.hands,
      input: settingsRef.current.input,
      trouble,
    };
    const runs = addRun(`${l.title}#${l.steps.length}`, run);
    setResult({ run, runs });
    setResultOpen(true);
  };

  /** After every change: the end of a loop pass, or of the whole piece. */
  const afterMove = (): void => {
    const f = followerRef.current;
    if (!f) return;
    const range = loopRef.current;
    if (range) {
      const [first, last] = loopSteps(range);
      if (f.position > last) {
        const m = f.byMeasure(first, last);
        const hit = m.reduce((a, x) => a + x.hit, 0);
        const missed = m.reduce((a, x) => a + x.missed, 0);
        const wrong = m.reduce((a, x) => a + x.wrong, 0);
        const score = accuracy({ hit, missed, wrong });
        setPasses((p) => [...p, score]);
        // A short breath before the loop starts again, so the last notes
        // of the pass are seen green before they reset.
        window.setTimeout(() => {
          if (!loopRef.current) return;
          apply(f.seek(first), false);
          colourAll();
          listenerRef.current?.reset();
        }, 350);
      }
      return;
    }
    if (f.finished && !reported.current) {
      reported.current = true;
      finishRun();
    }
  };

  const apply = (change: FollowChange, checkEnd = true): void => {
    const f = followerRef.current;
    for (const id of change.changed) colour(id);
    if (change.changed.length > 0 && runStart.current === null && f && f.stats().hit > 0) runStart.current = now();
    if (change.moved && f) {
      view.current.manual = null;
      // The other hand sounds as the player passes its notes.
      const s = settingsRef.current;
      if (s.accompany && s.hands !== 'both' && s.input !== 'none' && f.position > lastPosition.current) {
        const notes = [];
        for (let i = lastPosition.current; i < f.position && i < f.steps.length; i++) {
          const required = new Set(f.requiredIn(i).map((n) => n.id));
          notes.push(...f.steps[i]!.notes.filter((n) => !required.has(n.id)));
        }
        if (notes.length > 0) {
          playerRef.current.sound(notes);
          for (const n of notes) ownSound.current.set(n.midi, now());
        }
      }
      lastPosition.current = f.position;
      placeView();
    } else if (change.changed.length > 0) {
      placeCursor();
    }
    if (change.changed.length > 0 || change.moved || change.wrong !== undefined) refreshStats();
    if (checkEnd && change.moved) afterMove();
  };

  // Building the drawn score whenever a new layout arrives.
  useEffect(() => {
    if (!layout) return;
    const systems = layout.systems.map((s, i) => {
      const div = document.createElement('div');
      div.className = 'system';
      div.dataset['index'] = String(i);
      div.dataset['height'] = String(s.height);
      div.innerHTML = s.svg;
      return div;
    });
    const notes = new Map<string, Element>();
    const byId = new Map<string, Element>();
    for (const div of systems) {
      for (const n of div.querySelectorAll('g.note')) if (n.id) notes.set(n.id, n);
      for (const m of div.querySelectorAll('g.measure')) if (m.id) byId.set(m.id, m);
    }
    const stepOf = new Map<string, number>();
    const firstStepOf: number[] = [];
    layout.steps.forEach((step, i) => {
      for (const n of step.notes) stepOf.set(n.id, i);
      if (firstStepOf[step.system] === undefined) firstStepOf[step.system] = i;
    });
    for (let i = layout.systems.length - 1; i >= 0; i--) firstStepOf[i] ??= firstStepOf[i + 1] ?? layout.steps.length;
    const cursor = document.createElement('div');
    cursor.className = 'step-cursor';
    drawn.current = {
      systems,
      notes,
      measureEls: layout.measures.map((m) => byId.get(m.id) ?? null),
      stepOf,
      firstStepOf,
      current: [],
      playback: [],
      cursor,
      bands: [],
    };

    // The same score laid out again keeps its follower and all its colours;
    // only the lines the steps fall on have moved.
    const old = followerRef.current;
    const sameScore =
      old !== null &&
      old.steps.length === layout.steps.length &&
      old.steps.every((s, i) => s.notes[0]?.id === layout.steps[i]!.notes[0]?.id);
    if (old && sameScore) {
      layout.steps.forEach((s, i) => {
        (old.steps[i] as ScoreStep).system = s.system;
      });
    } else {
      followerRef.current = new ScoreFollower(layout.steps, {
        input: inputKind(settingsRef.current.input),
        staves: stavesFor(settingsRef.current.hands, layout.staves),
      });
      lastPosition.current = followerRef.current.position;
      view.current = { start: 0, manual: null };
    }
    colourAll();
    placeView();
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Hands and input take effect without a new layout.
  useEffect(() => {
    const f = followerRef.current;
    if (!f || !layout) return;
    apply(f.configure({ input: inputKind(settings.input), staves: stavesFor(settings.hands, layout.staves) }), false);
    lastPosition.current = f.position;
    colourAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.hands, settings.input]);

  useEffect(() => {
    view.current.manual = null;
    placeView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode]);

  useEffect(() => {
    placeBands();
    setPasses([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  // ------------------------------------------------------------- listening

  const onStrikes = (strikes: Strike[]): void => {
    const f = followerRef.current;
    if (!f) return;
    const t = now();
    for (const raw of strikes) {
      if (testListener.current) {
        testListener.current(raw);
        continue;
      }
      // What the app sounded itself a moment ago is not the player.
      const strike = {
        ...raw,
        notes: raw.notes.filter((n) => t - (ownSound.current.get(n.midi) ?? -Infinity) > 0.6),
      };
      if (raw.notes.length > 0 && strike.notes.length === 0) continue;
      apply(f.hear(strike, t));
      if (strike.notes.length === 0) continue;
      for (const n of strike.notes) keyboardRef.current?.flash(n.midi, n.expected ? 'ok' : 'wrong');
      setHeard(strike.notes.map((n) => noteName(n.midi) + (n.expected ? '' : ' ✕')).join('  '));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const stopAll = async (): Promise<void> => {
      midiRef.current?.stop();
      await micRef.current?.stop();
      listenerRef.current = null;
    };

    const start = async (): Promise<void> => {
      await stopAll();
      if (cancelled) return;
      if (settings.input === 'microphone') {
        setStatus('Připojuji mikrofon…');
        const access = await window.app.microphoneAccess();
        if (!access.ok || !access.data) {
          setStatus('Systém mikrofon nepovolil. Povol ho v nastavení soukromí a aplikaci spusť znovu.');
          return;
        }
        const mic = (micRef.current ??= new Microphone());
        try {
          await mic.start(settings.device || null, (samples) => {
            const listener = listenerRef.current;
            const f = followerRef.current;
            if (!listener || !f || playerRef.current.playing) return;
            if (testListener.current) listener.setExpected(TEST_CHORD, []);
            else {
              const e = f.expected();
              listener.setExpected(e.due, e.ahead);
            }
            const strikes = listener.push(samples);
            if (strikes.length > 0) onStrikes(strikes);
          });
        } catch (e) {
          setStatus(`Mikrofon není dostupný: ${(e as Error).message}`);
          return;
        }
        if (cancelled) {
          await mic.stop();
          return;
        }
        listenerRef.current = new NoteListener({
          sampleRate: mic.sampleRate,
          threshold: THRESHOLDS[settings.sensitivity],
        });
        setDevices(await Microphone.devices().catch(() => []));
        setStatus(`Poslouchám: ${mic.label || 'mikrofon'}`);
      } else if (settings.input === 'midi') {
        if (!MidiKeyboard.supported) {
          setStatus('Tohle prostředí MIDI nepodporuje.');
          return;
        }
        const midi = (midiRef.current ??= new MidiKeyboard());
        const describe = (): void =>
          setStatus(
            midi.inputs.length > 0
              ? `MIDI: ${midi.inputs.join(', ')}`
              : 'Žádná MIDI klávesnice — připoj digitální piano přes USB nebo Bluetooth.',
          );
        try {
          await midi.start((note) => {
            const f = followerRef.current;
            if (!f || playerRef.current.playing) return;
            const change = f.play(note, now());
            apply(change);
            keyboardRef.current?.flash(note, change.wrong !== undefined ? 'wrong' : 'ok');
            setHeard(noteName(note) + (change.wrong !== undefined ? ' ✕' : ''));
          }, describe);
        } catch (e) {
          setStatus(`MIDI není dostupné: ${(e as Error).message}`);
          return;
        }
        describe();
      } else {
        setStatus('Bez poslechu — otáčíš šipkami, mezerníkem nebo pedálem.');
      }
    };
    void start();
    return () => {
      cancelled = true;
      void stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.input, settings.device, settings.sensitivity]);

  // Grace periods run out even when nothing is played.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const f = followerRef.current;
      if (f) apply(f.tick(now()));
    }, 150);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The input meter, straight on the DOM at the frame rate.
  useEffect(() => {
    let frame = 0;
    const draw = (): void => {
      const bar = meterRef.current;
      if (bar) {
        const db = listenerRef.current ? listenerRef.current.level().rms : -120;
        bar.style.width = `${Math.max(0, Math.min(1, (db + 70) / 60)) * 100}%`;
        bar.classList.toggle('bg-destructive', db > -6);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The screen stays on while the score is open; the synthesizer goes with it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async (): Promise<void> => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        lock = null;
      }
    };
    void acquire();
    const again = (): void => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', again);
    const player = playerRef.current;
    return () => {
      document.removeEventListener('visibilitychange', again);
      void lock?.release().catch(() => undefined);
      void player.close();
    };
  }, []);

  // ------------------------------------------------------------ demonstration

  const clearPlayback = (): void => {
    const d = drawn.current;
    if (!d) return;
    for (const id of d.playback) d.notes.get(id)?.classList.remove('st-playback');
    d.playback = [];
    keyboardRef.current?.sounding([]);
  };

  const stopPlayback = (): void => {
    playerRef.current.stop();
    playbackStep.current = null;
    clearPlayback();
    setPlaying(false);
    view.current.manual = null;
    listenerRef.current?.reset();
    placeView();
  };

  const startPlayback = (): void => {
    const f = followerRef.current;
    if (!f) return;
    const range = loopRef.current;
    const from = range ? loopSteps(range)[0] : f.finished ? 0 : f.position;
    const until = range ? loopSteps(range)[1] : f.steps.length - 1;
    const steps = f.steps.slice(0, until + 1);
    setPlaying(true);
    playerRef.current.play(
      steps,
      from,
      settingsRef.current.speed,
      (index) => {
        const d = drawn.current;
        if (!d) return;
        clearPlayback();
        const step = f.steps[index];
        if (!step) return;
        d.playback = step.notes.map((n) => n.id);
        for (const id of d.playback) d.notes.get(id)?.classList.add('st-playback');
        keyboardRef.current?.sounding(step.notes.map((n) => n.midi));
        const previous = playbackStep.current;
        playbackStep.current = index;
        if (previous === null || f.steps[previous]?.system !== step.system) placeView();
        else placeCursor();
        setMeasure((step.measure ?? 0) + 1);
      },
      () => stopPlayback(),
    );
  };

  const togglePlayback = (): void => {
    if (playerRef.current.playing) stopPlayback();
    else startPlayback();
  };

  // ------------------------------------------------- turning by hand or pedal

  const turn = (direction: 1 | -1): void => {
    const d = drawn.current;
    const el = scoreRef.current;
    if (!d || !el) return;
    const mode = settingsRef.current.mode;
    if (mode === 'scroll') {
      el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' });
      return;
    }
    const shown = [...el.children].filter((c) => c.classList.contains('system')).length;
    const step = Math.max(1, mode === 'lines' ? shown - 1 : shown);
    const from = view.current.manual ?? (mode === 'pages' ? view.current.start : currentSystem());
    const target = Math.max(0, Math.min(d.systems.length - 1, from + direction * step));
    view.current.manual = target;
    if (mode === 'pages') view.current.start = target;
    placeView();
  };

  const restart = (): void => {
    const f = followerRef.current;
    if (!f) return;
    if (playerRef.current.playing) stopPlayback();
    const range = loopRef.current;
    view.current = { start: 0, manual: null };
    apply(range ? f.seek(loopSteps(range)[0]) : f.reset(), false);
    lastPosition.current = f.position;
    colourAll();
    listenerRef.current?.reset();
    runStart.current = null;
    reported.current = false;
    setHeard('');
    setPasses([]);
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  /** Loops one measure or a range; the finger goes to its start. */
  const loopOver = (range: Loop | null): void => {
    setLoop(range);
    loopRef.current = range;
    const f = followerRef.current;
    if (!range || !f) return;
    const [first] = loopSteps(range);
    apply(f.seek(first), false);
    lastPosition.current = f.position;
    colourAll();
  };

  const loopHere = (): void => {
    const f = followerRef.current;
    const l = layoutRef.current;
    if (!f || !l) return;
    const system = currentSystem();
    const inLine = l.measures.map((m, i) => ({ ...m, i })).filter((m) => m.system === system);
    const from = inLine[0]?.i ?? 0;
    const to = inLine[inLine.length - 1]?.i ?? from;
    loopOver({ from, to });
  };

  useEffect(() => {
    let last = 0;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key);
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
      if (forward || back) {
        e.preventDefault();
        // Some pedals send every press twice in quick succession.
        const t = performance.now();
        if (t - last < 250) return;
        last = t;
        turn(forward ? 1 : -1);
        return;
      }
      const s = settingsRef.current;
      switch (e.key.toLowerCase()) {
        case 'p':
          togglePlayback();
          break;
        case 'l':
          if (loopRef.current) loopOver(null);
          else loopHere();
          break;
        case 'r':
          restart();
          break;
        case 'h':
          update({ hands: s.hands === 'both' ? 'right' : s.hands === 'right' ? 'left' : 'both' });
          break;
        case 'f':
          toggleFullscreen();
          break;
        case '+':
        case '=':
          update({ scale: Math.min(100, s.scale + 5) });
          setScaleDraft(Math.min(100, s.scale + 5));
          break;
        case '-':
          update({ scale: Math.max(30, s.scale - 5) });
          setScaleDraft(Math.max(30, s.scale - 5));
          break;
        case '?':
          setHelpOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // --------------------------------------------------------- choosing a place

  const onScoreClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const d = drawn.current;
    const f = followerRef.current;
    if (!d || !f) return;
    const note = (e.target as Element).closest('g.note');
    let index = note ? d.stepOf.get(note.id) : undefined;
    if (index === undefined) {
      // Not on a note: the step closest to the click on that line.
      const system = (e.target as Element).closest<HTMLDivElement>('div.system');
      if (!system) return;
      const line = Number(system.dataset['index']);
      const box = system.getBoundingClientRect();
      let best = Infinity;
      f.steps.forEach((step, i) => {
        if (step.system !== line) return;
        const r = d.notes.get(step.notes[0]?.id ?? '')?.getBoundingClientRect();
        if (!r) return;
        const distance = Math.abs(r.left + r.width / 2 - e.clientX);
        if (distance < best && box) {
          best = distance;
          index = i;
        }
      });
    }
    if (index === undefined) return;
    // Shift-click stretches the loop to the clicked measure.
    const clicked = f.steps[index]?.measure ?? 0;
    if (e.shiftKey) {
      const current = f.current?.measure ?? clicked;
      const range = loopRef.current ?? { from: current, to: current };
      loopOver({ from: Math.min(range.from, clicked), to: Math.max(range.from, clicked) });
      return;
    }
    if (playerRef.current.playing) stopPlayback();
    view.current.manual = null;
    reported.current = false;
    apply(f.seek(index), false);
    lastPosition.current = f.position;
    colourAll();
    listenerRef.current?.reset();
  };

  // Buttons give their focus back, so the space bar and the pedal keep
  // turning pages instead of pressing the last button again.
  const blur = (e: React.MouseEvent): void => (e.currentTarget as HTMLElement).blur();

  const subscribeTest = useCallback((listener: (strike: Strike) => void) => {
    testListener.current = listener;
    return () => {
      testListener.current = null;
    };
  }, []);
  const inputLevel = useCallback(() => listenerRef.current?.level().rms ?? -120, []);

  const twoHands = (layout?.staves.length ?? 0) >= 2;
  const measures = layout?.measures.length ?? 0;
  const done = stats.hit + stats.missed;
  const cleanPasses = passes.filter((p) => p >= CLEAN).length;

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto] bg-stage">
      {/* ------------------------------------------------------------ bar */}
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Hint label="Zpět">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Zpět">
            <ArrowLeft />
          </Button>
        </Hint>
        <div className="mr-1 min-w-0">
          <div className="max-w-56 truncate text-sm font-semibold" title={title}>
            {title}
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            takt {Math.min(measure, Math.max(1, measures))} z {measures}
          </div>
        </div>

        <Separator orientation="vertical" className="mx-1 h-7!" />

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="shrink-0"
          value={settings.input}
          onValueChange={(v) => v && update({ input: v as Input })}
          aria-label="Poslech"
        >
          <ToggleGroupItem value="microphone" aria-label="Mikrofon">
            <Mic aria-hidden />
            <span className="hidden xl:inline">Mikrofon</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="midi" aria-label="MIDI klávesnice">
            <Piano aria-hidden />
            <span className="hidden xl:inline">MIDI</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="none" aria-label="Bez poslechu">
            <EarOff aria-hidden />
            <span className="hidden xl:inline">Bez poslechu</span>
          </ToggleGroupItem>
        </ToggleGroup>

        {settings.input === 'microphone' && (
          <Hint label="Hlasitost na vstupu">
            <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div ref={meterRef} className="h-full w-0 rounded-full bg-success transition-[width] duration-75" />
            </div>
          </Hint>
        )}

        {twoHands && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="shrink-0"
            value={settings.hands}
            onValueChange={(v) => v && update({ hands: v as Hands })}
            aria-label="Ruce"
          >
            <ToggleGroupItem value="both">Obě ruce</ToggleGroupItem>
            <ToggleGroupItem value="right">Pravá</ToggleGroupItem>
            <ToggleGroupItem value="left">Levá</ToggleGroupItem>
          </ToggleGroup>
        )}

        <div className="flex-1" />

        <Hint label={playing ? 'Zastavit ukázku (P)' : 'Poslechnout, jak to má znít (P)'}>
          <Button
            variant={playing ? 'default' : 'outline'}
            size="sm"
            onClick={(e) => {
              blur(e);
              togglePlayback();
            }}
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            <span className="hidden lg:inline">{playing ? 'Zastavit' : 'Poslechnout'}</span>
          </Button>
        </Hint>

        <Popover>
          <Hint label="Opakovat úsek (L, Shift+klik na takt)">
            <PopoverTrigger asChild>
              <Button variant={loop ? 'default' : 'outline'} size="sm" aria-label="Smyčka">
                <Repeat aria-hidden />
                <span className="hidden lg:inline">
                  {loop ? `Takty ${loop.from + 1}–${loop.to + 1}` : 'Smyčka'}
                </span>
              </Button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent align="end" className="w-80 space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="loop-on">Opakovat úsek</Label>
              <Switch
                id="loop-on"
                checked={loop !== null}
                onCheckedChange={(on) => (on ? loopHere() : loopOver(null))}
              />
            </div>
            {loop && (
              <>
                {(
                  [
                    ['from', 'Od taktu'],
                    ['to', 'Do taktu'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`${label} o jeden méně`}
                        onClick={() => {
                          const v = Math.max(0, loop[key] - 1);
                          loopOver(key === 'from' ? { from: v, to: loop.to } : { from: Math.min(loop.from, v), to: v });
                        }}
                      >
                        −
                      </Button>
                      <span className="w-10 text-center font-semibold tabular-nums">{loop[key] + 1}</span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`${label} o jeden více`}
                        onClick={() => {
                          const v = Math.min(measures - 1, loop[key] + 1);
                          loopOver(key === 'from' ? { from: v, to: Math.max(loop.to, v) } : { from: loop.from, to: v });
                        }}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={loopHere}>
                    Celý tento řádek
                  </Button>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  {passes.length === 0 ? (
                    <span className="text-muted-foreground">
                      Hraj úsek dokola. Průchod s přesností aspoň {CLEAN} % se počítá jako čistý.
                    </span>
                  ) : (
                    <>
                      <div className="font-medium">
                        {cleanPasses} z {passes.length} průchodů čistě
                      </div>
                      <div className="mt-2 flex h-8 items-end gap-1">
                        {passes.slice(-16).map((p, i) => (
                          <div
                            key={i}
                            title={`${p} %`}
                            className={cn('w-2 rounded-sm', p >= CLEAN ? 'bg-success' : 'bg-destructive/70')}
                            style={{ height: `${Math.max(8, p)}%` }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">Tip: Shift+klik na notu natáhne smyčku k jejímu taktu.</p>
          </PopoverContent>
        </Popover>

        <Hint label={loop ? 'Na začátek smyčky (R)' : 'Od začátku (R)'}>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={(e) => {
              blur(e);
              restart();
            }}
            aria-label="Od začátku"
          >
            <RotateCcw />
          </Button>
        </Hint>

        <Popover>
          <Hint label="Nastavení">
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Nastavení">
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent align="end" className="w-80 space-y-4">
            <div className="space-y-2">
              <Label>Otáčení not</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                className="w-full"
                value={settings.mode}
                onValueChange={(v) => v && update({ mode: v as TurnMode })}
              >
                <ToggleGroupItem value="lines">Po řádcích</ToggleGroupItem>
                <ToggleGroupItem value="pages">Stránky</ToggleGroupItem>
                <ToggleGroupItem value="scroll">Plynule</ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {settings.mode === 'lines'
                  ? 'Dohraný řádek se hned vymění za další — vidíš vždy dopředu, nic neposkočí.'
                  : settings.mode === 'pages'
                    ? 'Celá obrazovka se otočí v polovině posledního řádku; ten zůstane nahoře.'
                    : 'Noty plynule jedou nahoru, aktuální řádek je u horního okraje.'}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Velikost not</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{scaleDraft} %</span>
              </div>
              <Slider
                min={30}
                max={100}
                step={5}
                value={[scaleDraft]}
                onValueChange={([v]) => setScaleDraft(v ?? 50)}
                onValueCommit={([v]) => update({ scale: v ?? 50 })}
                aria-label="Velikost not"
              />
            </div>

            <div className="space-y-2">
              <Label>Tempo ukázky</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                className="w-full"
                value={String(settings.speed)}
                onValueChange={(v) => v && update({ speed: Number(v) })}
              >
                <ToggleGroupItem value="0.5">50 %</ToggleGroupItem>
                <ToggleGroupItem value="0.75">75 %</ToggleGroupItem>
                <ToggleGroupItem value="1">100 %</ToggleGroupItem>
              </ToggleGroup>
            </div>

            {settings.input === 'microphone' && (
              <div className="space-y-2">
                <Label>Mikrofon</Label>
                <Select value={settings.device || 'default'} onValueChange={(v) => update({ device: v === 'default' ? '' : v })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Výchozí mikrofon</SelectItem>
                    {devices
                      .filter((d) => d.id && d.id !== 'default')
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  value={settings.sensitivity}
                  onValueChange={(v) => v && update({ sensitivity: v as Sensitivity })}
                  aria-label="Citlivost"
                >
                  <ToggleGroupItem value="low">Méně citlivý</ToggleGroupItem>
                  <ToggleGroupItem value="medium">Střed</ToggleGroupItem>
                  <ToggleGroupItem value="high">Citlivější</ToggleGroupItem>
                </ToggleGroup>
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setMicTestOpen(true)}>
                  <Mic aria-hidden /> Vyzkoušet mikrofon…
                </Button>
              </div>
            )}

            <Separator />
            {(
              [
                ['night', 'Tmavý papír', <Moon key="i" className="size-4" aria-hidden />],
                ['keyboard', 'Klaviatura pod notami', <KeyboardIcon key="i" className="size-4" aria-hidden />],
                ['accompany', 'Doprovod druhé ruky', <Piano key="i" className="size-4" aria-hidden />],
              ] as const
            ).map(([key, label, icon]) => (
              <div key={key} className="flex items-center justify-between">
                <Label htmlFor={`s-${key}`} className="font-normal">
                  {icon}
                  {label}
                </Label>
                <Switch id={`s-${key}`} checked={settings[key]} onCheckedChange={(v) => update({ [key]: v })} />
              </div>
            ))}
            {settings.accompany && settings.hands !== 'both' && settings.input === 'microphone' && (
              <p className="text-xs text-muted-foreground">
                S mikrofonem hraj doprovod do sluchátek; noty, které zahraje aplikace, se ignorují.
              </p>
            )}
          </PopoverContent>
        </Popover>

        <Hint label="Klávesové zkratky (?)">
          <Button variant="ghost" size="icon-sm" onClick={() => setHelpOpen(true)} aria-label="Klávesové zkratky">
            <CircleHelp />
          </Button>
        </Hint>
        <Hint label="Celá obrazovka (F)">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              blur(e);
              toggleFullscreen();
            }}
            aria-label="Celá obrazovka"
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
        </Hint>
      </header>

      {/* ---------------------------------------------------------- score */}
      <main className="relative min-h-0 p-2">
        <div
          ref={scoreRef}
          onClick={onScoreClick}
          className={cn(
            'score-sheet flex h-full cursor-pointer flex-col overflow-hidden rounded-lg shadow-xl ring-1 ring-black/5',
            settings.night && 'night',
          )}
        />
        {!layout && !error && (
          <div className="absolute inset-2 grid place-items-center text-sm text-muted-foreground">Sázím noty…</div>
        )}
        {error && <div className="absolute inset-2 grid place-items-center text-sm text-destructive">{error}</div>}
      </main>

      {/* --------------------------------------------------------- footer */}
      <footer className="flex items-center gap-4 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="max-w-80 truncate" role="status">
          {status}
        </span>
        <span className="flex-1 truncate font-medium text-foreground tabular-nums" aria-live="polite">
          {heard && <>Slyším: {heard}</>}
        </span>
        <span className="hidden truncate lg:inline">Klikni na notu a hraj odtud</span>
        <div className="flex items-center gap-2">
          <Progress
            value={stats.total > 0 ? (stats.hit / stats.total) * 100 : 0}
            className="h-1.5 w-28 bg-muted"
            indicatorClassName="bg-success"
            aria-label="Zahráno ze skladby"
          />
          <Badge variant="success" title="Zahrané noty">
            {stats.hit}/{stats.total}
          </Badge>
          <Badge variant={stats.missed > 0 ? 'destructive' : 'secondary'} title="Vynechané noty">
            vynecháno {stats.missed}
          </Badge>
          {settings.input !== 'none' && (
            <Badge variant={stats.wrong > 0 ? 'destructive' : 'secondary'} title="Noty vedle">
              chyby {stats.wrong}
            </Badge>
          )}
          {done > 0 && (
            <Badge variant="outline" title="Přesnost dosud">
              {accuracy(stats)} %
            </Badge>
          )}
        </div>
      </footer>
      <div className={cn('h-12 px-2 pb-2', !settings.keyboard && 'hidden')}>
        <Keyboard ref={keyboardRef} />
      </div>

      <ResultsDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        run={result?.run ?? null}
        runs={result?.runs ?? (layout ? runsOf(`${layout.title}#${layout.steps.length}`) : [])}
        onAgain={() => {
          setResultOpen(false);
          restart();
        }}
        onPractise={(m) => {
          setResultOpen(false);
          loopOver({ from: Math.max(0, m - 1), to: Math.max(0, m - 1) });
        }}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <MicTestDialog open={micTestOpen} onOpenChange={setMicTestOpen} subscribe={subscribeTest} level={inputLevel} />
    </div>
  );
}
