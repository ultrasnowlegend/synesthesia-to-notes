import type { ScoreNote, ScoreStep } from '../../../src/core/follow.js';

/**
 * Plays the score through a small piano-like synthesizer: to hear how a
 * passage should go before playing it, and to sound the other hand while one
 * hand practises. A few detuned oscillators through a closing low-pass filter
 * and a decaying envelope — no samples to ship, and plenty for a demonstration.
 */
export class ScorePlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer = 0;
  private timeouts: number[] = [];
  private playing_ = false;

  get playing(): boolean {
    return this.playing_;
  }

  private ensure(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 3;
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(compressor).connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  /** One note at an audio-clock time, for `seconds` of written length. */
  private voice(midi: number, at: number, seconds: number, velocity: number): void {
    const ctx = this.ensure();
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const length = Math.min(4, Math.max(0.15, seconds));
    const end = at + length + 0.35;

    const gain = ctx.createGain();
    const peak = 0.16 * velocity * (midi < 48 ? 1.2 : 1);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, at + Math.min(0.4, length));
    gain.gain.setValueAtTime(peak * 0.35 * Math.exp(-length / 1.6), at + length);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(12000, f * 9), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2.5), at + Math.min(1.2, length + 0.2));
    filter.connect(gain).connect(this.master!);

    for (const [type, ratio, level, detune] of [
      ['triangle', 1, 1, 0],
      ['sine', 2, 0.35, 3],
      ['sine', 1, 0.5, -4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start(at);
      osc.stop(end + 0.05);
    }
  }

  /** Sounds notes right away; the other hand while one hand practises. */
  sound(notes: readonly ScoreNote[]): void {
    const ctx = this.ensure();
    for (const n of notes) this.voice(n.midi, ctx.currentTime + 0.01, (n.duration ?? 500) / 1000, 0.7);
  }

  /**
   * Plays steps from `from` on at `speed` times the written tempo. `onStep`
   * fires as each step begins, in step with what is heard, so the cursor and
   * the page turning can follow; `onEnd` when the last one has passed.
   */
  play(
    steps: readonly ScoreStep[],
    from: number,
    speed: number,
    onStep: (index: number) => void,
    onEnd: () => void,
    filter: (note: ScoreNote) => boolean = () => true,
  ): void {
    this.stop();
    const ctx = this.ensure();
    const first = steps[from];
    if (!first) return;
    this.playing_ = true;
    const start = ctx.currentTime + 0.15;
    let next = from;
    const tick = (): void => {
      // Schedule a little ahead on the audio clock, which never stutters.
      const horizon = ctx.currentTime + 0.25;
      while (next < steps.length) {
        const step = steps[next]!;
        const at = start + (step.time - first.time) / 1000 / speed;
        if (at > horizon) break;
        for (const n of step.notes) {
          if (filter(n)) this.voice(n.midi, at, (n.duration ?? 500) / 1000 / speed, 0.75);
        }
        const index = next;
        this.timeouts.push(window.setTimeout(() => onStep(index), Math.max(0, (at - ctx.currentTime) * 1000)));
        next++;
      }
      if (next >= steps.length) {
        window.clearInterval(this.timer);
        const last = steps[steps.length - 1]!;
        const tail = start + (last.time - first.time) / 1000 / speed + 1.2 - ctx.currentTime;
        this.timeouts.push(
          window.setTimeout(() => {
            this.playing_ = false;
            onEnd();
          }, tail * 1000),
        );
      }
    };
    tick();
    this.timer = window.setInterval(tick, 40);
  }

  stop(): void {
    window.clearInterval(this.timer);
    for (const t of this.timeouts) window.clearTimeout(t);
    this.timeouts = [];
    this.playing_ = false;
    // Silence what is already scheduled by swapping the output stage.
    if (this.context && this.master) {
      const old = this.master;
      old.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
      window.setTimeout(() => old.disconnect(), 300);
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 3;
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(compressor).connect(this.context.destination);
    }
  }

  async close(): Promise<void> {
    this.stop();
    const ctx = this.context;
    this.context = null;
    this.master = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
