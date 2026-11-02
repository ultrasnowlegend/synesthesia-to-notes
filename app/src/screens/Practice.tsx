import { useCallback, useEffect, useRef, useState } from 'react';

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
import { Keyboard, type KeyboardHandle } from '../practice/Keyboard.js';
import { MidiKeyboard } from '../practice/midi.js';
import { Microphone, type AudioDevice } from '../practice/microphone.js';
import { noteName } from '../practice/names.js';

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
}

const DEFAULTS: Settings = {
  input: 'microphone',
  device: '',
  hands: 'both',
  mode: 'lines',
  scale: 50,
  sensitivity: 'medium',
};

const THRESHOLDS: Record<Sensitivity, number> = { low: 0.42, medium: 0.32, high: 0.25 };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('practice-settings');
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Settings are a convenience; without them the defaults do.
  }
  return DEFAULTS;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem('practice-settings', JSON.stringify(s));
  } catch {
    // Not remembered this time.
  }
}

const now = (): number => performance.now() / 1000;

/** Staves played with the chosen hands; the top staff is the right hand. */
function stavesFor(hands: Hands, staves: number[]): number[] {
  if (hands === 'both' || staves.length < 2) return [];
  return hands === 'right' ? [staves[0]!] : staves.slice(1);
}

/**
 * Playing from the score: the engraved score cut to the window, a finger on
 * the step due now, notes turning green when they are heard and red when they
 * are passed by, and lines of music turned without a hand.
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
  const [midiNames, setMidiNames] = useState<string[]>([]);
  const [stats, setStats] = useState<FollowStats>({ hit: 0, missed: 0, wrong: 0, total: 0 });
  const [heard, setHeard] = useState('');
  const [finished, setFinished] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const scoreRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<KeyboardHandle>(null);
  const followerRef = useRef<ScoreFollower | null>(null);
  const listenerRef = useRef<NoteListener | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const midiRef = useRef<MidiKeyboard | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Drawn lines of music and the lookups into them. */
  const drawn = useRef<{
    systems: HTMLDivElement[];
    notes: Map<string, Element>;
    stepOf: Map<string, number>;
    firstStepOf: number[];
    current: string[];
    cursor: HTMLDivElement;
  } | null>(null);
  /** What the screen shows: the first line of a page, or a line looked ahead to by hand. */
  const view = useRef<{ start: number; manual: number | null }>({ start: 0, manual: null });

  const update = (patch: Partial<Settings>): void => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  };

  // ---------------------------------------------------------------- layout

  const requestLayout = useCallback(async () => {
    const el = scoreRef.current;
    if (!el) return;
    const width = Math.max(320, el.clientWidth - 2);
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
  };

  const currentSystem = (): number => {
    const f = followerRef.current;
    const d = drawn.current;
    if (!f || !d) return 0;
    const step = f.current ?? f.steps[f.steps.length - 1];
    return Math.min(d.systems.length - 1, step?.system ?? 0);
  };

  /** How far through its line the player is, 0..1. */
  const progress = (): number => {
    const f = followerRef.current;
    const d = drawn.current;
    if (!f || !d) return 0;
    const system = currentSystem();
    const first = d.firstStepOf[system] ?? 0;
    const next = d.firstStepOf[system + 1] ?? f.steps.length;
    return next > first ? (f.position - first) / (next - first) : 0;
  };

  const placeCursor = (): void => {
    const d = drawn.current;
    const f = followerRef.current;
    if (!d || !f) return;
    for (const id of d.current) d.notes.get(id)?.classList.remove('st-current');
    const step = f.current;
    d.current = step
      ? step.notes.filter((n) => f.state(n.id) === 'pending').map((n) => n.id)
      : [];
    for (const id of d.current) d.notes.get(id)?.classList.add('st-current');

    const system = step ? d.systems[step.system] : undefined;
    if (!step || !system || !system.isConnected) {
      d.cursor.style.display = 'none';
      return;
    }
    const box = system.getBoundingClientRect();
    let left = Infinity;
    let right = -Infinity;
    for (const n of step.notes) {
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
    const playing = currentSystem();
    const line = view.current.manual ?? playing;
    const heights = d.systems.map((s) => s.offsetHeight || Number(s.dataset['height'] ?? 200));

    el.classList.toggle('scrolling', mode === 'scroll');
    if (mode === 'scroll') {
      if (el.childElementCount !== total || el.firstElementChild !== d.systems[0]) {
        el.replaceChildren(...d.systems);
      }
      for (const s of d.systems) s.classList.remove('is-playing', 'is-next');
      d.systems[playing]?.classList.add('is-playing');
      const target = d.systems[line];
      if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - height * 0.12), behavior: 'smooth' });
      placeCursor();
      return;
    }

    let shown: number[];
    if (mode === 'lines') {
      const tallest = Math.max(...heights);
      const slots = Math.max(1, Math.floor(height / tallest));
      shown = lineSlots(line, slots, total);
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
      const start = pageStart(
        view.current.start,
        line,
        view.current.manual === null ? progress() : 0,
        fits,
        total,
      );
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
    for (const s of d.systems) s.classList.remove('is-playing', 'is-next');
    d.systems[playing]?.classList.add('is-playing');
    // In "lines" the reading continues from the bottom back to the top; the
    // line that comes next after the playing one is marked so the eye finds it.
    if (mode === 'lines' && playing + 1 < total) d.systems[playing + 1]?.classList.add('is-next');
    el.scrollTop = 0;
    placeCursor();
  };

  const refreshStats = (): void => {
    const f = followerRef.current;
    if (!f) return;
    setStats(f.stats());
    setFinished(f.finished);
    keyboardRef.current?.expect(f.expected().due);
  };

  const apply = (change: FollowChange): void => {
    for (const id of change.changed) colour(id);
    if (change.moved) {
      view.current.manual = null;
      placeView();
    } else if (change.changed.length > 0) {
      placeCursor();
    }
    if (change.changed.length > 0 || change.moved || change.wrong !== undefined) refreshStats();
  };

  const colourAll = (): void => {
    const d = drawn.current;
    if (!d) return;
    for (const id of d.notes.keys()) colour(id);
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
    for (const div of systems) {
      for (const n of div.querySelectorAll('g.note')) if (n.id) notes.set(n.id, n);
    }
    const stepOf = new Map<string, number>();
    const firstStepOf: number[] = [];
    layout.steps.forEach((step, i) => {
      for (const n of step.notes) stepOf.set(n.id, i);
      if (firstStepOf[step.system] === undefined) firstStepOf[step.system] = i;
    });
    // A line with no step of its own starts where the next one does.
    for (let i = layout.systems.length - 1; i >= 0; i--) {
      firstStepOf[i] ??= firstStepOf[i + 1] ?? layout.steps.length;
    }
    const cursor = document.createElement('div');
    cursor.className = 'step-cursor';
    drawn.current = { systems, notes, stepOf, firstStepOf, current: [], cursor };

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
      view.current = { start: 0, manual: null };
    }
    colourAll();
    placeView();
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Hands, input and mode take effect without a new layout.
  useEffect(() => {
    const f = followerRef.current;
    if (!f || !layout) return;
    apply(
      f.configure({
        input: inputKind(settings.input),
        staves: stavesFor(settings.hands, layout.staves),
      }),
    );
    colourAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.hands, settings.input]);

  useEffect(() => {
    view.current.manual = null;
    placeView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode]);

  // ------------------------------------------------------------- listening

  const onStrikes = (strikes: Strike[]): void => {
    const f = followerRef.current;
    if (!f) return;
    for (const strike of strikes) {
      apply(f.hear(strike, now()));
      if (strike.notes.length === 0) continue;
      for (const n of strike.notes) keyboardRef.current?.flash(n.midi, n.expected ? 'ok' : 'wrong');
      setHeard(strike.notes.map((n) => noteName(n.midi) + (n.expected ? '' : ' ✗')).join('  '));
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
            if (!listener || !f) return;
            const e = f.expected();
            listener.setExpected(e.due, e.ahead);
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
        const describe = (): void => {
          setMidiNames(midi.inputs);
          setStatus(
            midi.inputs.length > 0
              ? `MIDI: ${midi.inputs.join(', ')}`
              : 'Žádná MIDI klávesnice — připoj ji kabelem nebo přes Bluetooth.',
          );
        };
        try {
          await midi.start((note) => {
            const f = followerRef.current;
            if (!f) return;
            const change = f.play(note, now());
            apply(change);
            keyboardRef.current?.flash(note, change.wrong !== undefined ? 'wrong' : 'ok');
            setHeard(noteName(note) + (change.wrong !== undefined ? ' ✗' : ''));
          }, describe);
        } catch (e) {
          setStatus(`MIDI není dostupné: ${(e as Error).message}`);
          return;
        }
        describe();
      } else {
        setStatus('Bez poslechu — stránky otáčíš šipkami, mezerníkem nebo pedálem.');
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
      const listener = listenerRef.current;
      const bar = meterRef.current;
      if (bar) {
        const db = listener ? listener.level().rms : -120;
        const fill = Math.max(0, Math.min(1, (db + 70) / 60));
        bar.style.width = `${fill * 100}%`;
        bar.classList.toggle('hot', db > -6);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The screen stays on while the score is open.
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
    return () => {
      document.removeEventListener('visibilitychange', again);
      void lock?.release().catch(() => undefined);
    };
  }, []);

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

  useEffect(() => {
    let last = 0;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key);
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
      if (!forward && !back) return;
      e.preventDefault();
      // Some pedals send every press twice in quick succession.
      const t = performance.now();
      if (t - last < 250) return;
      last = t;
      turn(forward ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const distance = Math.abs(r.left + r.width / 2 - box.left - (e.clientX - box.left));
        if (distance < best) {
          best = distance;
          index = i;
        }
      });
    }
    if (index === undefined) return;
    view.current.manual = null;
    apply(f.seek(index));
    colourAll();
    listenerRef.current?.reset();
  };

  const restart = (): void => {
    const f = followerRef.current;
    if (!f) return;
    view.current = { start: 0, manual: null };
    apply(f.reset());
    colourAll();
    listenerRef.current?.reset();
    setHeard('');
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Buttons give their focus back, so the space bar and the pedal keep
  // turning pages instead of pressing the last button again.
  const blur = (e: React.MouseEvent): void => (e.currentTarget as HTMLElement).blur();

  const percent = stats.total > 0 ? Math.round((stats.hit / stats.total) * 100) : 0;
  const twoHands = (layout?.staves.length ?? 0) >= 2;

  return (
    <div className={`practice${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="practice-bar">
        <button onClick={onBack} title="Zpět">
          ←
        </button>
        <span className="name" title={title}>
          {title}
        </span>

        <div className="segmented" role="group" aria-label="Poslech">
          {(
            [
              ['microphone', 'Mikrofon'],
              ['midi', 'MIDI'],
              ['none', 'Bez poslechu'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={settings.input === value ? 'on' : ''}
              onClick={(e) => {
                blur(e);
                update({ input: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {settings.input === 'microphone' && (
          <>
            {devices.length > 1 && (
              <select
                className="compact"
                value={settings.device}
                onChange={(e) => update({ device: e.target.value })}
                aria-label="Mikrofon"
              >
                <option value="">Výchozí mikrofon</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
            <div className="meter" title="Hlasitost na vstupu">
              <div ref={meterRef} className="meter-fill" />
            </div>
            <select
              className="compact"
              value={settings.sensitivity}
              onChange={(e) => update({ sensitivity: e.target.value as Sensitivity })}
              aria-label="Citlivost"
              title="Citlivost poslechu"
            >
              <option value="low">Citlivost: nízká</option>
              <option value="medium">Citlivost: střední</option>
              <option value="high">Citlivost: vysoká</option>
            </select>
          </>
        )}

        {twoHands && (
          <div className="segmented" role="group" aria-label="Ruce">
            {(
              [
                ['both', 'Obě ruce'],
                ['right', 'Pravá'],
                ['left', 'Levá'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={settings.hands === value ? 'on' : ''}
                onClick={(e) => {
                  blur(e);
                  update({ hands: value });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <select
          className="compact"
          value={settings.mode}
          onChange={(e) => update({ mode: e.target.value as TurnMode })}
          aria-label="Otáčení"
          title="Jak se otáčí noty"
        >
          <option value="lines">Otáčet po řádcích</option>
          <option value="pages">Otáčet po stránkách</option>
          <option value="scroll">Plynulé posouvání</option>
        </select>

        <div className="zoom" role="group" aria-label="Velikost not">
          <button
            onClick={(e) => {
              blur(e);
              update({ scale: Math.max(30, settings.scale - 5) });
            }}
            title="Menší noty"
          >
            A−
          </button>
          <button
            onClick={(e) => {
              blur(e);
              update({ scale: Math.min(100, settings.scale + 5) });
            }}
            title="Větší noty"
          >
            A+
          </button>
        </div>

        <span className="spacer" />
        <span className="chip" title="Zahrané noty">
          <b className="ok">{stats.hit}</b> / {stats.total}
        </span>
        <span className="chip" title="Vynechané noty">
          vynecháno <b className="bad">{stats.missed}</b>
        </span>
        {settings.input !== 'none' && (
          <span className="chip" title="Noty navíc nebo vedle">
            chyby <b className="bad">{stats.wrong}</b>
          </span>
        )}
        <button
          onClick={(e) => {
            blur(e);
            restart();
          }}
          title="Od začátku"
        >
          Od začátku
        </button>
        <button
          onClick={(e) => {
            blur(e);
            toggleFullscreen();
          }}
          title="Celá obrazovka"
        >
          {fullscreen ? 'Zmenšit' : 'Celá obrazovka'}
        </button>
      </div>

      <div className="practice-stage">
        <div ref={scoreRef} className="practice-score" onClick={onScoreClick} />
        {!layout && !error && <div className="practice-overlay">Sázím noty…</div>}
        {error && <div className="practice-overlay error">{error}</div>}
        {finished && (
          <div className="practice-overlay done">
            <div className="done-card">
              <h2>Dohráno</h2>
              <p>
                Zahráno <b>{stats.hit}</b> z <b>{stats.total}</b> not ({percent} %)
                {settings.input !== 'none' && (
                  <>
                    , {stats.missed} vynecháno, {stats.wrong} chyb
                  </>
                )}
                .
              </p>
              <button className="primary" onClick={restart}>
                Znovu od začátku
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="practice-foot">
        <span className="status">{status}</span>
        <span className="heard">{heard && <>Slyším: {heard}</>}</span>
        {settings.input === 'midi' && midiNames.length === 0 && (
          <span className="hint">Tip: digitální piano připoj přes USB a vyber MIDI.</span>
        )}
        <span className="hint">Klikni na notu a hraj odtud · ←/→ nebo pedál otáčí</span>
      </div>
      <Keyboard ref={keyboardRef} />
    </div>
  );
}

function inputKind(input: Input): InputKind {
  return input === 'microphone' ? 'audio' : 'midi';
}
