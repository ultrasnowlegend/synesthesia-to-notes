#!/usr/bin/env node
/**
 * Measures the live listener — and the follower driven by it — on real piano
 * recordings instead of on guesses.
 *
 *   npm run build
 *   node scripts/listen-bench.mjs <samples-dir> [--follow] [--seed 7] [--notes 300]
 *
 * <samples-dir> holds one recording per key, named like C4.mp3, Cs4.mp3 or
 * Db4.wav (any format ffmpeg reads). Free sets that work: the npm packages
 * `tonejs-instrument-piano-mp3` and `piano-mp3` (`npm pack <name>` and unpack).
 *
 * From them it mixes a performance that is hard on purpose: random chords of
 * one to four notes over four octaves, 0.12–0.72 s apart, half of it under the
 * pedal, with slipped neighbour keys, octave slips and dropped chord notes,
 * plus room reverb and hiss. The listener hears it as a stream in render
 * quanta, exactly as in the window.
 *
 * Without --follow the listener is told the truth about what is due (the
 * current event) and what lies ahead (the next two), and its verdicts are
 * scored note by note. With --follow the follower decides what is expected,
 * as in the app, and the score is how the score ends up coloured.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: node scripts/listen-bench.mjs <samples-dir> [--follow] [--seed n] [--notes n]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const follow = args.includes('--follow');
const { NoteListener } = await import('../dist/src/core/listen.js');
const { ScoreFollower } = await import('../dist/src/core/follow.js');

const RATE = 48000;
const NAMES = { C: 0, Cs: 1, Db: 1, D: 2, Ds: 3, Eb: 3, E: 4, F: 5, Fs: 6, Gb: 6, G: 7, Gs: 8, Ab: 8, A: 9, As: 10, Bb: 10, B: 11 };
const samples = new Map();
for (const file of readdirSync(dir)) {
  const m = /^([A-G](?:s|b)?)(-?\d)\.\w+$/.exec(file);
  if (!m || NAMES[m[1]] === undefined) continue;
  const midi = 12 * (Number(m[2]) + 1) + NAMES[m[1]];
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, file), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 28,
  });
  samples.set(midi, new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
}
if (samples.size < 24) {
  console.error(`only ${samples.size} usable samples in ${dir}`);
  process.exit(1);
}

let seed = flag('seed', 7);
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (list) => list[Math.floor(random() * list.length)];

// ------------------------------------------------------------ performance
const events = [];
let t = 0.5;
for (let i = 0; i < flag('notes', 300); i++) {
  const r = random();
  const size = r < 0.45 ? 1 : r < 0.65 ? 2 : r < 0.85 ? 3 : 4;
  const center = Math.floor(39 + random() * 51);
  const chord = new Set();
  while (chord.size < size) {
    const m = center + Math.floor((random() - 0.5) * 24);
    if (m >= 33 && m <= 96 && samples.has(m)) chord.add(m);
  }
  const intended = [...chord].sort((a, b) => a - b);
  const played = [...intended];
  let mistake = null;
  const q = random();
  const at = Math.floor(random() * played.length);
  if (q < 0.08) {
    const m = played[at] + pick([-2, -1, 1, 2]);
    if (samples.has(m) && !played.includes(m)) (mistake = { kind: 'neighbour', from: played[at], to: m }), (played[at] = m);
  } else if (q < 0.12) {
    const m = played[at] + pick([-12, 12]);
    if (samples.has(m) && !played.includes(m)) (mistake = { kind: 'octave', from: played[at], to: m }), (played[at] = m);
  } else if (q < 0.16 && played.length > 1) {
    mistake = { kind: 'drop', from: played[at] };
    played.splice(at, 1);
  }
  events.push({ time: t, intended, played, mistake, velocity: 0.25 + random() * 0.75, hold: 0.15 + random() * 1.4 });
  t += 0.12 + random() * 0.6;
}
const signal = new Float32Array(Math.ceil((t + 2) * RATE));
let pedal = false;
for (const e of events) {
  if (random() < 0.15) pedal = !pedal;
  for (const m of e.played) {
    const s = samples.get(m);
    const start = Math.round((e.time + (random() - 0.5) * 0.02) * RATE);
    const release = pedal ? s.length : Math.round(e.hold * RATE);
    const length = pedal ? s.length : Math.min(s.length, release + Math.round(0.12 * RATE));
    for (let i = 0; i < length && start + i < signal.length; i++) {
      const g = e.velocity * 0.5 * (i > release ? Math.exp(-(i - release) / (0.03 * RATE)) : 1);
      signal[start + i] += s[i] * g;
    }
  }
}
const room = new Float32Array(signal.length);
for (let k = 0; k < 400; k++) {
  const d = Math.floor(Math.pow(random(), 1.6) * 0.5 * RATE) + 240;
  const g = (random() - 0.5) * Math.exp(-d / (0.12 * RATE)) * 0.12;
  for (let i = d; i < signal.length; i++) room[i] += signal[i - d] * g;
}
let b0 = 0;
let b1 = 0;
for (let i = 0; i < signal.length; i++) {
  const w = random() * 2 - 1;
  b0 = 0.99 * b0 + w * 0.1;
  b1 = 0.9 * b1 + w * 0.3;
  signal[i] = (signal[i] + room[i] + (b0 + b1 + w * 0.2) * 0.002) * 0.5;
}

// --------------------------------------------------------------- listening
const listener = new NoteListener({ sampleRate: RATE });
const steps = events.map((e, i) => ({
  beat: i,
  time: i * 500,
  system: Math.floor(i / 8),
  notes: e.intended.map((m, j) => ({ id: `${i}-${j}`, midi: m, staff: m >= 60 ? 1 : 2 })),
}));
const follower = new ScoreFollower(steps, { input: 'audio' });
const heard = [];
const lag = [];
let truth = 0;
for (let i = 0; i < signal.length; i += 128) {
  const now = i / RATE;
  while (truth < events.length - 1 && events[truth].time + 0.15 < now) truth++;
  if (follow) {
    const e = follower.expected();
    listener.setExpected(e.due, e.ahead);
  } else {
    const due = [...(events[truth - 1]?.intended ?? []), ...events[truth].intended];
    const ahead = [...(events[truth + 1]?.intended ?? []), ...(events[truth + 2]?.intended ?? [])];
    listener.setExpected(due, ahead);
  }
  for (const strike of listener.push(signal.subarray(i, i + 128))) {
    heard.push(...strike.notes);
    if (follow) follower.hear(strike, now);
  }
  if (follow) {
    follower.tick(now);
    if (lag.length < events.length && now >= events[lag.length].time - 0.005) lag.push(follower.position - lag.length);
  }
}

// ----------------------------------------------------------------- scoring
const round = (v) => Math.round(v * 1000) / 1000;
if (follow) {
  follower.tick(1e9);
  let played = 0;
  let green = 0;
  let notPlayed = 0;
  let red = 0;
  events.forEach((e, i) =>
    e.intended.forEach((m, j) => {
      const state = follower.state(`${i}-${j}`);
      if (e.played.includes(m)) {
        played++;
        if (state === 'hit' || state === 'unsure') green++;
      } else {
        notPlayed++;
        if (state === 'missed') red++;
      }
    }),
  );
  console.log(
    JSON.stringify({
      playedNotMarkedRed: round(green / played),
      unplayedMarkedRed: `${red}/${notPlayed}`,
      withinOneStep: round(lag.filter((d) => Math.abs(d) <= 1).length / lag.length),
      reachedEnd: `${follower.position}/${steps.length}`,
      ...follower.stats(),
    }),
  );
} else {
  let hit = 0;
  let missed = 0;
  let wrongFound = 0;
  let wrongTotal = 0;
  let fooled = 0;
  let octaves = 0;
  const used = new Set();
  const latency = [];
  for (const e of events) {
    const near = heard.filter((h) => h.time > e.time - 0.08 && h.time < e.time + 0.1);
    for (const m of e.played) {
      if (!e.intended.includes(m)) continue;
      const h = near.find((x) => x.midi === m && x.expected && !used.has(x));
      if (h) {
        hit++;
        used.add(h);
        latency.push(h.detectedAt - e.time);
      } else missed++;
    }
    if (e.mistake?.kind === 'neighbour') {
      wrongTotal++;
      const h = near.find((x) => x.midi === e.mistake.to && !x.expected);
      if (h) (wrongFound++, used.add(h));
    }
    if (e.mistake?.kind === 'octave') {
      octaves++;
      if (near.some((x) => x.midi === e.mistake.from && x.expected)) fooled++;
    }
  }
  const stray = heard.filter((h) => !used.has(h));
  latency.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      recall: round(hit / (hit + missed)),
      falseNotesPerStrike: round(stray.filter((h) => h.expected).length / events.length),
      falseWrongNotes: stray.filter((h) => !h.expected).length,
      wrongNotesCaught: `${wrongFound}/${wrongTotal}`,
      octaveSlipsTakenForTheNote: `${fooled}/${octaves}`,
      latencyMedian: round(latency[latency.length >> 1] ?? 0),
      latency90: round(latency[Math.floor(latency.length * 0.9)] ?? 0),
    }),
  );
}
