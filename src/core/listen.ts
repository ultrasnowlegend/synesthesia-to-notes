import { fft } from './fourier.js';

/**
 * Listening to a live piano through a microphone, knowing what should be played.
 *
 * Blind polyphonic transcription from audio is exactly what this project avoids
 * elsewhere: overtones of one note land on the fundamentals of others and the
 * guesses go wrong by octaves. Here the problem is far narrower, because the
 * score says what is coming. The listener never asks "which notes are these?",
 * only "did the few notes the score expects just begin?" — a question with a
 * yes or no answer per note.
 *
 * The answer rests on three observations:
 *
 * 1. A struck note announces itself by a sudden *rise* of energy, not by its
 *    presence. Everything still ringing from before — held notes, the pedal —
 *    has a falling envelope and disappears from the difference of two moments.
 *    So the listener first finds strikes (onsets) and then looks only at what
 *    rose across each of them.
 * 2. A note rises at all its partials at once. The partials of a piano string
 *    are not exact multiples of the fundamental — the stiffness of the string
 *    stretches them upwards — so the template follows the inharmonicity curve
 *    of a real piano rather than a plain harmonic series.
 * 3. The two errors that matter are the octave below and the octave above. The
 *    note an octave lower has partials on every partial of the expected note,
 *    *and* halfway between them; so energy rising between the partials vetoes
 *    the note. The note an octave higher feeds only the even partials, so the
 *    odd ones must rise as well.
 *
 * All levels are compared in the logarithm of magnitude: a rise is a ratio, and
 * a ratio does not care how loud the instrument is or how far the microphone.
 */

export interface ListenerOptions {
  sampleRate: number;
  /** FFT length; a power of two. Defaults to the one closest to 85 ms. */
  window?: number;
  /** Hop between frames in samples. Defaults to an eighth of the window. */
  hop?: number;
  /** Partials taken into account per note. */
  partials?: number;
  /** Partials above this frequency are ignored; the microphone and room colour them too much. */
  maxFrequency?: number;
  /** Strike detection: how far above its recent average the onset function must rise. */
  onsetThreshold?: number;
  /** Evidence a note expected by the score needs to count as played. */
  threshold?: number;
  /** Evidence an unexpected neighbouring note needs to count as a wrong note. */
  wrongThreshold?: number;
  /**
   * Compression of the log magnitude, relative to the loudest recent partial:
   * a partial this many times quieter than it sits at the knee of the curve.
   */
  compression?: number;
  /** Whether to look for wrong notes next to the expected ones at all. */
  detectWrongNotes?: boolean;
  /** Width of the window a partial is looked for in, as a fraction of its frequency. */
  tolerance?: number;
  /**
   * How much more evidence a note further ahead in the score needs than one
   * due now. Hearing a note from further on means the player skipped
   * something, which is rarer than playing what comes next.
   */
  aheadFactor?: number;
}

export interface HeardNote {
  midi: number;
  /** Estimated time of the strike, in seconds since the listener started. */
  time: number;
  /** Time at which the note was recognised; the difference is the latency. */
  detectedAt: number;
  /** Evidence divided by the threshold it had to pass; 1 means just enough. */
  strength: number;
  /** Whether the score expected this note. False means a wrong note. */
  expected: boolean;
}

/**
 * One strike and what was recognised in it. A strike with no notes still
 * matters: it says the player is playing something the score did not expect
 * here, which is how a follower learns that it has lost its place.
 */
export interface Strike {
  /** Estimated time of the strike, in seconds since the listener started. */
  time: number;
  /** Time of the verdict. */
  detectedAt: number;
  notes: HeardNote[];
}

/** Input level, for the meter in the window. */
export interface ListenerLevel {
  /** RMS of the last hop in dBFS. */
  rms: number;
  /** Peak of the last hop in dBFS. */
  peak: number;
}

const DEFAULTS = {
  partials: 12,
  maxFrequency: 6000,
  onsetThreshold: 0.008,
  threshold: 0.32,
  wrongThreshold: 0.8,
  compression: 150,
  detectWrongNotes: true,
  tolerance: 0.015,
  aheadFactor: 1.5,
} as const;

export function midiFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Inharmonicity coefficient B of a typical grand piano: f_n = n f0 sqrt(1 + B n²).
 * Two straight lines in log B, one for the wound bass strings and one for the
 * treble, after the parametric model of Rigaud, David and Daudet (2013).
 */
export function inharmonicity(midi: number): number {
  return Math.exp(-0.0942 * midi - 5.39) + Math.exp(0.0915 * midi - 13.64);
}

/** Frequency of the n-th partial of a piano note. */
export function partialFrequency(midi: number, n: number): number {
  return n * midiFrequency(midi) * Math.sqrt(1 + inharmonicity(midi) * n * n);
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface Pending {
  /** Frame index of the onset peak. */
  frame: number;
  time: number;
  /** Pitches due now, at the moment of the strike. */
  due: number[];
  /** Pitches further ahead, at the moment of the strike. */
  ahead: number[];
}

interface Template {
  /** Bin ranges of the partials, as [from, to] pairs. */
  partials: Int32Array;
  /** Bin ranges halfway between the partials (the odd partials of the octave below). */
  between: Int32Array;
  /** Weight of each partial. */
  weights: Float32Array;
  /** Whether a partial number is odd; the octave above feeds only the even ones. */
  odd: Uint8Array;
}

/**
 * Streams audio in and reports notes as they are struck. Pure computation with
 * no Web Audio in it, so it runs the same in the window and under a test.
 */
export class NoteListener {
  readonly sampleRate: number;
  readonly window: number;
  readonly hop: number;
  private readonly options: Required<Omit<ListenerOptions, 'window' | 'hop' | 'sampleRate'>>;

  private readonly ring: Float32Array;
  private ringAt = 0;
  private sinceHop = 0;
  private total = 0;
  private frame = 0;

  private readonly hann: Float64Array;
  private readonly norm: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly bins: number;
  private readonly lowBin: number;
  private readonly highBin: number;

  /** Magnitude spectra of recent frames, a ring of `history` entries. */
  private readonly spectra: Float32Array[];
  /**
   * The loudest partial of the last few seconds. Levels are judged relative to
   * it, so a quiet microphone and a loud one see the same picture, and the
   * hiss of an empty room stays below notice.
   */
  private reference = 1e-3;
  /** Mean magnitude of a quiet frame: the hiss of the room and the microphone. */
  private noise = 1e-6;
  /** Loudest bin of the latest frame. */
  private loudest = 0;
  private readonly history: number;
  private readonly odf: Float32Array;

  private readonly pending: Pending[] = [];
  private lastOnset = -Infinity;
  private readonly lastReported = new Map<number, number>();
  private readonly templates = new Map<number, Template>();
  private due: number[] = [];
  private ahead: number[] = [];
  private hopRms = 0;
  private hopPeak = 0;

  /** Last frame after the onset peak the rise is measured at. */
  private readonly post: number;
  /** First frame after the onset peak the rise is measured at. */
  private readonly postFrom: number;
  /** Frames before the onset peak the "before" spectrum comes from. */
  private readonly pre: number;

  constructor(options: ListenerOptions) {
    this.sampleRate = options.sampleRate;
    this.window = options.window ?? nextPowerOfTwo(Math.round(options.sampleRate * 0.085));
    this.hop = options.hop ?? this.window / 8;
    this.options = {
      partials: options.partials ?? DEFAULTS.partials,
      maxFrequency: options.maxFrequency ?? DEFAULTS.maxFrequency,
      onsetThreshold: options.onsetThreshold ?? DEFAULTS.onsetThreshold,
      threshold: options.threshold ?? DEFAULTS.threshold,
      wrongThreshold: options.wrongThreshold ?? DEFAULTS.wrongThreshold,
      compression: options.compression ?? DEFAULTS.compression,
      detectWrongNotes: options.detectWrongNotes ?? DEFAULTS.detectWrongNotes,
      tolerance: options.tolerance ?? DEFAULTS.tolerance,
      aheadFactor: options.aheadFactor ?? DEFAULTS.aheadFactor,
    };

    this.ring = new Float32Array(this.window);
    this.hann = new Float64Array(this.window);
    let sum = 0;
    for (let i = 0; i < this.window; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.window);
      sum += this.hann[i]!;
    }
    // A sine of amplitude A then peaks at A in the magnitude spectrum.
    this.norm = 2 / sum;
    this.re = new Float64Array(this.window);
    this.im = new Float64Array(this.window);
    this.bins = this.window / 2;
    const binHz = this.sampleRate / this.window;
    this.lowBin = Math.max(1, Math.floor(25 / binHz));
    this.highBin = Math.min(this.bins - 1, Math.ceil(this.options.maxFrequency / binHz));

    // Half a window: by then the strike sits in the middle of the frame.
    // The strike reaches the middle of the frame half a window after it
    // happens, and the knock of the hammer and the body of the instrument dies
    // away a few tens of milliseconds later. The "after" spectrum is therefore
    // taken from the last quarter of a whole window past the onset: measured
    // on real piano recordings, that keeps the recall and removes a third of
    // the false notes, for some 40 ms of extra latency.
    const half = Math.max(2, Math.round(this.window / 2 / this.hop));
    this.post = half * 2;
    this.postFrom = Math.round(half * 1.5);
    this.pre = half + 1;
    this.history = this.pre + this.post + 8;
    this.spectra = Array.from({ length: this.history }, () => new Float32Array(this.bins));
    this.odf = new Float32Array(this.history);
  }

  /** Seconds of audio consumed so far. */
  get time(): number {
    return this.total / this.sampleRate;
  }

  /** How long after a strike a note is reported, in seconds; the latency floor. */
  get latency(): number {
    return ((this.post + 1) * this.hop + this.window / 2) / this.sampleRate;
  }

  level(): ListenerLevel {
    const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -120);
    return { rms: db(this.hopRms), peak: db(this.hopPeak) };
  }

  /**
   * The notes the score expects: those due now and those a little further on.
   * Strikes are judged against the sets that held at the moment of the strike,
   * not at the moment of the verdict.
   */
  setExpected(due: Iterable<number>, ahead: Iterable<number> = []): void {
    const clean = (v: Iterable<number>): number[] =>
      [...new Set(v)].filter((m) => m >= 21 && m <= 108).sort((a, b) => a - b);
    this.due = clean(due);
    const now = new Set(this.due);
    this.ahead = clean(ahead).filter((m) => !now.has(m));
  }

  /** Forgets everything heard; the expected set stays. */
  reset(): void {
    this.ring.fill(0);
    for (const s of this.spectra) s.fill(0);
    this.reference = 1e-3;
    this.noise = 1e-6;
    this.odf.fill(0);
    this.pending.length = 0;
    this.lastReported.clear();
    this.lastOnset = -Infinity;
  }

  /** Feeds samples in; returns the strikes judged within them. */
  push(samples: Float32Array): Strike[] {
    const out: Strike[] = [];
    let sumSquares = 0;
    let peak = 0;
    let count = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!;
      this.ring[this.ringAt] = v;
      this.ringAt = (this.ringAt + 1) % this.window;
      this.total++;
      sumSquares += v * v;
      peak = Math.max(peak, Math.abs(v));
      count++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.hopRms = Math.sqrt(sumSquares / Math.max(1, count));
        this.hopPeak = peak;
        sumSquares = 0;
        peak = 0;
        count = 0;
        this.analyse(out);
      }
    }
    return out;
  }

  private spectrum(frame: number): Float32Array {
    return this.spectra[((frame % this.history) + this.history) % this.history]!;
  }

  private analyse(out: Strike[]): void {
    const { re, im, hann, ring } = this;
    for (let i = 0; i < this.window; i++) {
      re[i] = ring[(this.ringAt + i) % this.window]! * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);

    const frame = this.frame++;
    const current = this.spectrum(frame);
    let loudest = 0;
    let mean = 0;
    for (let k = 0; k < this.bins; k++) {
      const v = Math.hypot(re[k]!, im[k]!) * this.norm;
      current[k] = v;
      if (k >= this.lowBin && k <= this.highBin) {
        mean += v;
        if (v > loudest) loudest = v;
      }
    }
    mean /= this.highBin - this.lowBin + 1;
    this.loudest = loudest;
    // The noise floor follows the quietest frames: it drops at once and creeps
    // up by about 3 dB a second, so a held chord is never taken for hiss.
    const seconds = this.hop / this.sampleRate;
    this.noise = Math.min(Math.max(mean, 1e-7), this.noise * Math.pow(1.41, seconds));
    // The reference rises at once and falls by half in about three seconds,
    // but never below forty decibels over the hiss, so an empty room is not
    // magnified into a storm of tiny strikes.
    const decay = Math.pow(0.5, seconds / 3);
    this.reference = Math.max(loudest, this.reference * decay, this.noise * 100, 1e-5);
    const gamma = this.options.compression / this.reference;

    // Onset function after SuperFlux: the rise against the maximum of the
    // neighbouring bins two frames back, so a slightly detuned partial that
    // wavers between two bins does not count as a new strike.
    const before = this.spectrum(frame - 2);
    let flux = 0;
    for (let k = this.lowBin; k <= this.highBin; k++) {
      const reference = Math.max(before[k - 1]!, before[k]!, before[k + 1]!);
      const rise = Math.log1p(gamma * current[k]!) - Math.log1p(gamma * reference);
      if (rise > 0) flux += rise;
    }
    this.odf[frame % this.history] = flux / (this.highBin - this.lowBin + 1);

    this.pickOnset(frame - 1);

    while (this.pending.length > 0 && this.pending[0]!.frame + this.post <= frame) {
      this.judge(this.pending.shift()!, frame, out);
    }
  }

  private odfAt(frame: number): number {
    if (frame < 0) return 0;
    return this.odf[frame % this.history]!;
  }

  /**
   * A frame is a strike when its onset function is the highest of its close
   * neighbourhood and clearly above the recent average. The peak is confirmed
   * one frame late, which is all the look-ahead the live setting allows.
   */
  private pickOnset(frame: number): void {
    if (frame < 4) return;
    const value = this.odfAt(frame);
    if (value <= this.odfAt(frame + 1)) return;
    for (let i = 1; i <= 3; i++) if (value < this.odfAt(frame - i)) return;

    let mean = 0;
    const span = Math.min(this.history - 2, 12);
    for (let i = 1; i <= span; i++) mean += this.odfAt(frame - i);
    mean /= span;
    if (value < mean * 1.15 + this.options.onsetThreshold) return;

    // Nothing stands out of the hiss: a breath, a chair, not a piano.
    if (this.loudest < this.noise * 30) return;

    const time = ((frame + 1) * this.hop - this.window / 2) / this.sampleRate;
    if (time - this.lastOnset < 0.03) return;
    this.lastOnset = time;
    if (this.due.length + this.ahead.length === 0) return;
    this.pending.push({ frame, time: Math.max(0, time), due: this.due, ahead: this.ahead });
  }

  private template(midi: number): Template {
    const cached = this.templates.get(midi);
    if (cached) return cached;

    const binHz = this.sampleRate / this.window;
    const f0 = midiFrequency(midi);
    const partials: number[] = [];
    const between: number[] = [];
    const weights: number[] = [];
    const odd: number[] = [];
    const range = (hz: number): [number, number] => {
      // A quarter of a semitone either way covers tuning and the stretch the
      // model misses, but never less than the bin and its neighbours.
      const width = Math.max(1.01, (hz * this.options.tolerance) / binHz);
      return [Math.max(this.lowBin, Math.round(hz / binHz - width)), Math.round(hz / binHz + width)];
    };
    for (let n = 1; n <= this.options.partials; n++) {
      const hz = partialFrequency(midi, n);
      if (hz > this.options.maxFrequency) break;
      // A bass fundamental is weak on a real piano and unresolvable at this
      // window length; it is left to the partials above it.
      if (hz < 2.5 * binHz) continue;
      const half = (partialFrequency(midi, n) + (n > 1 ? partialFrequency(midi, n - 1) : 0)) / 2;
      partials.push(...range(hz));
      between.push(...range(n > 1 ? half : hz / 2));
      weights.push(1 / Math.sqrt(n));
      odd.push(n % 2);
    }
    const t: Template = {
      partials: Int32Array.from(partials),
      between: Int32Array.from(between),
      weights: Float32Array.from(weights),
      odd: Uint8Array.from(odd),
    };
    this.templates.set(midi, t);
    return t;
  }

  /**
   * How convincingly a note began: the rise at its partials minus the rise
   * halfway between them, weighted towards the low partials. A broadband thump
   * rises everywhere and scores zero; the octave below rises in between and
   * scores below zero; the octave above leaves the odd partials flat.
   *
   * Bins in `explained` belong to notes already accepted at this strike. A
   * partial falling there proves nothing either way and is left out, and a gap
   * falling there is not held against the note. Without this, every note that
   * shares partials with a struck chord — the fifth, the third, the octave —
   * would be heard as well.
   *
   * Returns NaN when nothing is left to judge by: every partial is shared.
   */
  evidence(
    rise: Float32Array,
    peak: Uint8Array,
    midi: number,
    explained?: Uint8Array,
    allowOctaveBelow = false,
  ): number {
    const t = this.template(midi);
    const n = t.weights.length;
    if (n === 0) return Number.NaN;
    const covered = (from: number, to: number): boolean => {
      if (!explained) return false;
      for (let k = from; k <= to; k++) if (explained[k]) return true;
      return false;
    };
    let all = 0;
    let allWeight = 0;
    let odd = 0;
    let oddWeight = 0;
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      const w = t.weights[i]!;
      totalWeight += w;
      const from = t.partials[i * 2]!;
      const to = t.partials[i * 2 + 1]!;
      if (covered(from, to)) continue;
      // No peak in the window means no partial: count what the window did,
      // but never in the note's favour.
      let at = -Infinity;
      let fallback = -Infinity;
      for (let k = from; k <= to; k++) {
        const v = rise[k] ?? 0;
        if (peak[k]) at = Math.max(at, v);
        fallback = Math.max(fallback, v);
      }
      if (at === -Infinity) at = Math.min(0, fallback);
      let gap = 0;
      const gapFrom = t.between[i * 2]!;
      const gapTo = t.between[i * 2 + 1]!;
      if (!covered(gapFrom, gapTo)) {
        for (let k = gapFrom; k <= gapTo; k++) if (peak[k]) gap = Math.max(gap, rise[k] ?? 0);
      }
      const contrast = allowOctaveBelow ? at - Math.min(gap, at * 0.5) : at - gap;
      all += w * contrast;
      allWeight += w;
      if (t.odd[i]) {
        odd += w * contrast;
        oddWeight += w;
      }
    }
    // Too little of the note is its own to say anything.
    if (allWeight < totalWeight * 0.3) return Number.NaN;
    const mean = all / allWeight;
    const oddMean = oddWeight > 0 ? odd / oddWeight : mean;
    // The weaker of the two decides: both all partials and the odd ones alone
    // have to rise.
    return Math.min(mean, oddMean * 1.25);
  }

  private explain(explained: Uint8Array, midi: number): void {
    const t = this.template(midi);
    for (let i = 0; i < t.weights.length; i++) {
      for (let k = t.partials[i * 2]!; k <= t.partials[i * 2 + 1]!; k++) explained[k] = 1;
    }
  }

  /**
   * The rise spectrum across a strike: the most after it against the most
   * before it. Comparing peak to peak matters: the unison strings of a piano
   * beat against each other, and a ringing partial wavering by a few decibels
   * would otherwise look like a fresh strike whenever its trough fell before
   * the onset and its crest after. The value stays signed, so a partial that
   * is dying away counts against the note it belongs to.
   */
  private riseAt(onset: number): { rise: Float32Array; peak: Uint8Array } {
    const rise = new Float32Array(this.bins);
    const peak = new Uint8Array(this.bins);
    const high = new Float32Array(this.bins);
    for (let f = onset + this.postFrom; f <= onset + this.post; f++) {
      const s = this.spectrum(f);
      for (let k = this.lowBin - 1; k <= this.highBin + 1; k++) if (s[k]! > high[k]!) high[k] = s[k]!;
    }
    // The last frame no longer holds the strike itself, only what rings on.
    const last = this.spectrum(onset + this.post);
    const low = new Float32Array(this.bins);
    for (let f = onset - this.pre - 1; f <= onset - this.pre + 1; f++) {
      const s = this.spectrum(f);
      for (let k = this.lowBin; k <= this.highBin; k++) if (s[k]! > low[k]!) low[k] = s[k]!;
    }
    const gamma = this.options.compression / this.reference;
    for (let k = this.lowBin; k <= this.highBin; k++) {
      const before = Math.log1p(gamma * low[k]!);
      // A string keeps sounding; a clap, a cough or a knock on the lid is
      // gone by the last frame. What did not last cannot count for much.
      rise[k] = Math.min(Math.log1p(gamma * high[k]!), Math.log1p(gamma * last[k]!) + 0.2) - before;
      // Only a peak of the spectrum after the strike is a partial; the skirts
      // around a loud partial rise too, but they are its leakage, not a note.
      peak[k] = high[k]! >= high[k - 1]! && high[k]! >= high[k + 1]! ? 1 : 0;
    }
    return { rise, peak };
  }

  private judge(p: Pending, frame: number, strikes: Strike[]): void {
    const { rise, peak } = this.riseAt(p.frame);
    const detectedAt = ((frame + 1) * this.hop) / this.sampleRate;
    const out: HeardNote[] = [];
    strikes.push({ time: p.time, detectedAt, notes: out });
    const due = new Set(p.due);
    const expected = new Set([...p.due, ...p.ahead]);
    const { threshold, aheadFactor } = this.options;
    const needed = (midi: number): number => (due.has(midi) ? threshold : threshold * aheadFactor);

    // Greedy, strongest first: an accepted note explains its partials away
    // before the next candidate is judged.
    const candidates = [...expected]
      .map((midi) => ({ midi, first: this.evidence(rise, peak, midi, undefined, expected.has(midi - 12)) }))
      .filter((c) => c.first >= needed(c.midi) * 0.5)
      .sort((a, b) => b.first / needed(b.midi) - a.first / needed(a.midi));

    const explained = new Uint8Array(this.bins);
    const found = new Map<number, number>();
    for (const c of candidates) {
      let e = this.evidence(rise, peak, c.midi, explained, expected.has(c.midi - 12));
      if (Number.isNaN(e)) {
        // Every partial is shared with a note already heard — typically the
        // octave above it. The spectrum cannot tell a doubled octave from a
        // single note, so only a note due right now gets the benefit of the
        // doubt, on its unexplained evidence.
        if (!due.has(c.midi)) continue;
        e = c.first;
      }
      if (e < needed(c.midi)) continue;
      found.set(c.midi, e);
      this.explain(explained, c.midi);
    }

    const report = (midi: number, e: number, isExpected: boolean, limit: number): void => {
      const last = this.lastReported.get(midi);
      // A note heard a moment ago is still ringing, and the unison strings of
      // a piano beat: a partial swelling out of a beat trough looks like a new
      // strike. A real repetition rises far more, so it has to prove itself.
      if (last !== undefined && p.time - last < 0.6 && (p.time - last < 0.08 || e < limit * 1.6)) return;
      this.lastReported.set(midi, p.time);
      out.push({ midi, time: p.time, detectedAt, strength: e / limit, expected: isExpected });
    };
    for (const [midi, e] of found) report(midi, e, true, needed(midi));

    if (!this.options.detectWrongNotes) return;
    // A wrong note is nearly always a neighbouring key. It counts only when a
    // note due now was not heard and its neighbour rose instead, on partials
    // the correctly played notes do not explain.
    const wrong = new Set<number>();
    for (const m of p.due) {
      if (found.has(m)) continue;
      for (const d of [-2, -1, 1, 2]) if (!expected.has(m + d)) wrong.add(m + d);
    }
    for (const midi of wrong) {
      if (midi < 21 || midi > 108) continue;
      const e = this.evidence(rise, peak, midi, explained);
      if (Number.isNaN(e) || e < this.options.wrongThreshold) continue;
      report(midi, e, false, this.options.wrongThreshold);
    }
  }
}
