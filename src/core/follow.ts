/**
 * Following a player through a score, one played note at a time.
 *
 * The score is a chain of steps — everything that begins at the same moment —
 * and the follower keeps a finger on the step the player is due to play. It
 * never looks at the clock of the score: practising means stopping, repeating
 * and slowing down, so only the order of the notes counts. That is the "wait
 * mode" known from Synthesia, with two things added for reading from paper:
 *
 * - Moving on is allowed. Whoever plays the next step has left the current one
 *   behind, and its unplayed notes are marked as missed rather than holding the
 *   player hostage. A jump further ahead has to be confirmed by a second note,
 *   so one stray note never throws the finger half a line forward.
 * - A step just left behind stays open for a moment. A microphone hears the
 *   notes of a chord with slightly different delays, and the late ones must
 *   still land in the chord they belong to.
 *
 * The follower is pure logic; MIDI, the microphone and the drawing of the score
 * are all outside it.
 */

export interface ScoreNote {
  /** Identifier of the drawn note, so its colour can be changed. */
  id: string;
  midi: number;
  /** Staff the note is written on, from 1 at the top. */
  staff: number;
  /** How long it sounds at the written tempo, in milliseconds, ties included. */
  duration?: number;
}

export interface ScoreStep {
  /** Position in quarter notes from the beginning. */
  beat: number;
  /** Position in milliseconds at the written tempo. */
  time: number;
  /** The line of music (system) the step is drawn on, from 0. */
  system: number;
  /** The measure the step lies in, from 0. */
  measure?: number;
  notes: ScoreNote[];
}

/** How one measure went: for finding the places that need practice. */
export interface MeasureStats {
  measure: number;
  notes: number;
  hit: number;
  missed: number;
  wrong: number;
}

/**
 * `unsure` is a microphone's honest answer for a note of a chord that was
 * clearly played as a whole but whose every note it could not pick out —
 * neither praised nor counted as a mistake.
 */
export type NoteState = 'pending' | 'hit' | 'missed' | 'unsure' | 'skipped';

export type InputKind = 'midi' | 'audio';

export interface FollowerOptions {
  /** Staves the player plays. Notes on the others are greyed out and not waited for. */
  staves?: readonly number[];
  /**
   * MIDI is exact, so a chord is complete only with all its notes. A
   * microphone misses some, so most of a chord is enough to go on.
   */
  input?: InputKind;
  /** How many steps ahead a played note is looked for. */
  lookahead?: number;
  /** How long, in seconds, a step left behind still accepts its late notes. */
  grace?: number;
  /** Fraction of a chord that completes it when listening through a microphone. */
  chordFraction?: number;
}

export interface FollowChange {
  /** Notes whose state changed. */
  changed: string[];
  /** Whether the current position moved. */
  moved: boolean;
  /** Set when the note played belongs nowhere near the current position. */
  wrong?: number;
  /** Whether the note fitted the score around the finger. */
  matched?: boolean;
  /** Set when the follower lost the player and found them again elsewhere. */
  relocated?: boolean;
}

/** A strike heard through the microphone, as the listener reports it. */
export interface HeardStrike {
  time: number;
  notes: readonly { midi: number; expected: boolean }[];
}

export interface FollowStats {
  hit: number;
  missed: number;
  /** Notes of chords heard as a whole, but not one by one. */
  unsure: number;
  wrong: number;
  /** Notes the player is expected to play in the whole score. */
  total: number;
}

interface Open {
  index: number;
  until: number;
}

interface Candidate {
  index: number;
  midi: number;
  time: number;
}

export class ScoreFollower {
  readonly steps: readonly ScoreStep[];
  private options: Required<Omit<FollowerOptions, 'staves'>>;
  private staves: Set<number> | null;
  private readonly states = new Map<string, NoteState>();
  /** Required notes of each step: the ones on the staves being played. */
  private required: ScoreNote[][];
  private open: Open[] = [];
  private candidate: Candidate | null = null;
  private position_ = 0;
  private wrong = 0;
  /** Wrong notes counted against the measure the finger was in. */
  private wrongIn = new Map<number, number>();
  /** The strike that last moved the finger forward, when the input tells strikes apart. */
  private movedBy: number | null = null;
  /** Strikes in a row that fitted nowhere near the finger. */
  private lost = 0;
  /** When the finger last moved on. */
  private movedAt = -Infinity;
  /** Pitches of the latest strikes, newest last, for finding the player again. */
  private history: { time: number; pitches: number[] }[] = [];

  constructor(steps: readonly ScoreStep[], options: FollowerOptions = {}) {
    this.steps = steps;
    this.options = ScoreFollower.settle(options);
    this.staves = options.staves && options.staves.length > 0 ? new Set(options.staves) : null;
    this.required = steps.map((s) => s.notes.filter((n) => this.plays(n)));
    this.reset();
  }

  private static settle(options: FollowerOptions): Required<Omit<FollowerOptions, 'staves'>> {
    const input = options.input ?? 'midi';
    return {
      input,
      lookahead: options.lookahead ?? 3,
      grace: options.grace ?? (input === 'audio' ? 0.4 : 0.25),
      chordFraction: options.chordFraction ?? (input === 'audio' ? 0.6 : 1),
    };
  }

  /**
   * Changes the input or the hands mid-way. What lies before the finger keeps
   * its colours; from the finger on, the score is unplayed under the new rules.
   */
  configure(options: FollowerOptions): FollowChange {
    this.options = ScoreFollower.settle(options);
    this.staves = options.staves && options.staves.length > 0 ? new Set(options.staves) : null;
    this.required = this.steps.map((s) => s.notes.filter((n) => this.plays(n)));
    const wrong = this.wrong;
    const change = this.seek(this.position_);
    this.wrong = wrong;
    return change;
  }

  /** Index of the step due now; equals the number of steps at the end. */
  get position(): number {
    return this.position_;
  }

  get finished(): boolean {
    return this.position_ >= this.steps.length;
  }

  get current(): ScoreStep | undefined {
    return this.steps[this.position_];
  }

  state(id: string): NoteState {
    return this.states.get(id) ?? 'pending';
  }

  stats(): FollowStats {
    let hit = 0;
    let missed = 0;
    let unsure = 0;
    let total = 0;
    for (const list of this.required) {
      for (const n of list) {
        total++;
        const s = this.states.get(n.id);
        if (s === 'hit') hit++;
        else if (s === 'missed') missed++;
        else if (s === 'unsure') unsure++;
      }
    }
    return { hit, missed, unsure, wrong: this.wrong, total };
  }

  /** Results per measure, in order; measures without notes to play are left out. */
  byMeasure(from = 0, to = this.steps.length - 1): MeasureStats[] {
    const out = new Map<number, MeasureStats>();
    for (let i = Math.max(0, from); i <= Math.min(to, this.steps.length - 1); i++) {
      const measure = this.steps[i]!.measure ?? 0;
      let m = out.get(measure);
      if (!m) {
        m = { measure, notes: 0, hit: 0, missed: 0, wrong: this.wrongIn.get(measure) ?? 0 };
        out.set(measure, m);
      }
      for (const n of this.required[i]!) {
        m.notes++;
        const s = this.states.get(n.id);
        if (s === 'hit') m.hit++;
        else if (s === 'missed') m.missed++;
      }
    }
    return [...out.values()].filter((m) => m.notes > 0).sort((a, b) => a.measure - b.measure);
  }

  /** Notes on the staves being played in a step; the others are only drawn. */
  requiredIn(index: number): readonly ScoreNote[] {
    return this.required[index] ?? [];
  }

  /**
   * What the listener should be ready for: the notes due now — including
   * those still allowed to arrive late — and those of the next few steps.
   */
  expected(): { due: number[]; ahead: number[] } {
    const due = new Set<number>();
    const ahead = new Set<number>();
    const pendingOf = (i: number): number[] =>
      (this.required[i] ?? []).filter((n) => this.state(n.id) === 'pending').map((n) => n.midi);
    for (const o of this.open) for (const m of pendingOf(o.index)) due.add(m);
    for (const m of pendingOf(this.position_)) due.add(m);
    let seen = 0;
    const reach = this.reach();
    for (let i = this.position_ + 1; i < this.steps.length && seen < reach; i++) {
      if (this.required[i]!.length === 0) continue;
      seen++;
      for (const m of pendingOf(i)) if (!due.has(m)) ahead.add(m);
    }
    // Lost for a while: the player may also have gone back to repeat a passage.
    if (this.lost >= 3) {
      for (let i = Math.max(0, this.position_ - 16); i < this.position_; i++) {
        for (const n of this.required[i]!) if (!due.has(n.midi)) ahead.add(n.midi);
      }
    }
    return { due: [...due], ahead: [...ahead] };
  }

  /** Back to the beginning with every note unplayed. */
  reset(): FollowChange {
    return this.seek(0);
  }

  /**
   * Moves the finger to a step, for practising from a chosen place. Everything
   * from there on becomes unplayed again; what lies before stays as it was.
   */
  seek(index: number): FollowChange {
    const target = Math.max(0, Math.min(this.steps.length, Math.floor(index)));
    const changed: string[] = [];
    for (let i = target; i < this.steps.length; i++) {
      for (const n of this.steps[i]!.notes) {
        const next: NoteState = this.plays(n) ? 'pending' : 'skipped';
        if (this.states.get(n.id) !== next) changed.push(n.id);
        this.states.set(n.id, next);
      }
    }
    if (target === 0) {
      this.wrong = 0;
      this.wrongIn.clear();
    }
    this.open = [];
    this.candidate = null;
    this.movedBy = null;
    this.lost = 0;
    this.history = [];
    this.position_ = target;
    this.skipEmpty(changed);
    return { changed, moved: true };
  }

  /**
   * A strike heard through the microphone. Its notes are placed one by one,
   * and a strike that fits nowhere — or brings no recognisable note at all —
   * counts towards being lost.
   */
  hear(strike: HeardStrike, time: number): FollowChange {
    const change: FollowChange = { changed: [], moved: false };
    let matched = false;
    for (const n of strike.notes) {
      const c = this.play(n.midi, time, !n.expected, strike.time, false);
      change.changed.push(...c.changed);
      change.moved ||= c.moved;
      if (c.wrong !== undefined) change.wrong = c.wrong;
      matched ||= c.matched === true;
    }
    this.remember(strike.time, strike.notes.map((n) => n.midi));
    // Through a microphone a strike counts as found only when it moved the
    // finger on. A note due for a long time is eventually "heard" in some
    // unrelated strike, and if that kept counting as a match, a follower left
    // behind would never notice it is lost.
    this.settle(change.moved || (matched && this.recentlyMoved(time)), time, change);
    return change;
  }

  /**
   * A note was played at `time` seconds (any steady clock). `canBeWrong` is
   * false for a microphone verdict on a note the score expected: by the time
   * it arrives the finger may have moved on, which makes it late, not wrong.
   *
   * `strike` identifies the onset the note was heard in, when the input knows
   * it. One strike moves the finger by one step at most: a microphone judges
   * every note of a strike at once, and a note of the next step heard in the
   * same strike as the current chord is an echo of that chord, not the player
   * running ahead.
   */
  play(midi: number, time: number, canBeWrong = true, strike?: number, alone = true): FollowChange {
    const change = this.place_(midi, time, canBeWrong, strike);
    if (alone) {
      // A MIDI chord arrives as separate notes a few milliseconds apart; for
      // finding the player again they count as one strike.
      const last = this.history[this.history.length - 1];
      if (last && time - last.time < 0.05) last.pitches.push(midi);
      else this.remember(time, [midi]);
      this.settle(change.matched === true, time, change);
    }
    return change;
  }

  private place_(midi: number, time: number, canBeWrong: boolean, strike?: number): FollowChange {
    const change: FollowChange = { changed: [], moved: false };
    this.expire(time, change);
    if (this.finished) return change;

    // 1. The step due now.
    if (this.hitIn(this.position_, midi, change)) {
      change.matched = true;
      if (this.complete(this.position_)) {
        this.advance(time, change);
        this.movedBy = strike ?? null;
      }
      this.candidate = null;
      return change;
    }

    // 2. A step just left behind, still open for late notes.
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.hitIn(this.open[i]!.index, midi, change)) {
        change.matched = true;
        return change;
      }
    }

    // 3. A step further on: the player went ahead, or the current step was
    //    not heard. The very next step is taken at once; anything further
    //    needs a second note to confirm it.
    const ahead = this.findAhead(midi);
    if (ahead !== null && strike !== undefined && strike === this.movedBy) {
      // Heard in the strike that just completed the previous step.
      return change;
    }
    if (ahead !== null) {
      const earlier =
        this.candidate !== null &&
        time - this.candidate.time < 2.5 &&
        this.candidate.index > this.position_ &&
        ahead >= this.candidate.index &&
        ahead <= this.candidate.index + 1
          ? this.candidate
          : null;
      const target = ahead === this.nextRequired(this.position_) ? ahead : earlier?.index ?? null;
      if (target === null) {
        this.candidate = { index: ahead, midi, time };
        return change;
      }
      change.matched = true;
      this.candidate = null;
      this.jump(target, time, change);
      if (earlier && this.hitIn(earlier.index, earlier.midi, change) && this.complete(this.position_)) {
        this.advance(time, change);
      }
      if (ahead > this.position_) this.jump(ahead, time, change);
      this.place(midi, time, change);
      this.movedBy = strike ?? null;
      return change;
    }

    // 4. Something already played a moment ago: a repetition, or the same
    //    strike heard again. Neither is a mistake.
    // These do not count as finding the player either: someone going back to
    // repeat a phrase plays exactly such notes, and must be followed back.
    for (let i = this.position_ - 1; i >= Math.max(0, this.position_ - 3); i--) {
      if (this.steps[i]!.notes.some((n) => n.midi === midi)) return change;
    }

    if (canBeWrong) {
      this.wrong++;
      const measure = this.current?.measure ?? 0;
      this.wrongIn.set(measure, (this.wrongIn.get(measure) ?? 0) + 1);
      change.wrong = midi;
    }
    return change;
  }

  /** Closes steps whose grace has run out; call it now and then. */
  tick(time: number): FollowChange {
    const change: FollowChange = { changed: [], moved: false };
    this.expire(time, change);
    return change;
  }

  private recentlyMoved(time: number): boolean {
    return time - this.movedAt < 0.6;
  }

  /** How many steps ahead to look; the longer the player is lost, the further. */
  private reach(): number {
    return Math.min(24, this.options.lookahead + (this.lost >= 2 ? (this.lost - 1) * 4 : 0));
  }

  private remember(time: number, pitches: number[]): void {
    this.history.push({ time, pitches: [...pitches] });
    if (this.history.length > 6) this.history.shift();
  }

  private settle(matched: boolean, time: number, change: FollowChange): void {
    if (matched) {
      this.lost = 0;
      return;
    }
    this.lost++;
    if (this.lost >= 3 && this.relocate(time, change)) change.relocated = true;
  }

  /**
   * Looks for the place where the latest strikes fit the score in order, the
   * newest on the last step. Three strikes in a row must each match most of a
   * step, one step after another, so a passage that merely shares a few
   * pitches does not pull the finger away. The search reaches a couple of
   * lines forward but only about a line back — going back is what a player
   * does to repeat a phrase, not to start somewhere distant.
   */
  private relocate(time: number, change: FollowChange): boolean {
    const recent = this.history.filter((h) => h.pitches.length > 0).slice(-3);
    if (recent.length < 3) return false;
    const fits = (strike: number[], step: number): boolean => {
      const pitches = new Set(this.required[step]!.map((n) => n.midi));
      const shared = new Set(strike.filter((m) => pitches.has(m))).size;
      return shared > 0 && shared >= Math.min(pitches.size, new Set(strike).size) * 0.5;
    };
    let best: number | null = null;
    const from = Math.max(0, this.position_ - 24);
    const to = Math.min(this.steps.length - 1, this.position_ + 48);
    for (let i = from; i <= to; i++) {
      let j = i;
      let ok = true;
      for (let k = recent.length - 1; k >= 0 && ok; k--) {
        while (j >= 0 && this.required[j]!.length === 0) j--;
        ok = j >= 0 && fits(recent[k]!.pitches, j);
        j--;
      }
      if (!ok) continue;
      // Forward is likelier than back; nearer is likelier than far.
      const cost = (index: number): number =>
        index + 1 >= this.position_ ? index + 1 - this.position_ : (this.position_ - index - 1) * 3;
      if (best === null || cost(i) < cost(best)) best = i;
    }
    if (best === null) return false;

    const target = best + 1;
    if (target > this.position_) {
      this.jump(target, time, change);
    } else {
      const back = this.seek(target);
      change.changed.push(...back.changed);
      change.moved = true;
    }
    for (const m of recent[recent.length - 1]!.pitches) this.hitIn(best, m, change);
    this.lost = 0;
    this.history = [];
    return true;
  }

  private plays(n: ScoreNote): boolean {
    return this.staves === null || this.staves.has(n.staff);
  }

  /** Puts a note into the current step or, failing that, into an open one. */
  private place(midi: number, time: number, change: FollowChange): void {
    if (this.hitIn(this.position_, midi, change)) {
      if (this.complete(this.position_)) this.advance(time, change);
      return;
    }
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.hitIn(this.open[i]!.index, midi, change)) return;
    }
  }

  private hitIn(index: number, midi: number, change: FollowChange): boolean {
    let found = false;
    for (const n of this.required[index] ?? []) {
      if (n.midi === midi && this.state(n.id) === 'pending') {
        this.states.set(n.id, 'hit');
        change.changed.push(n.id);
        found = true;
      }
    }
    return found;
  }

  private complete(index: number): boolean {
    const list = this.required[index] ?? [];
    if (list.length === 0) return true;
    const hits = list.filter((n) => this.state(n.id) === 'hit').length;
    if (hits === list.length) return true;
    return list.length > 1 && hits >= Math.ceil(list.length * this.options.chordFraction);
  }

  private nextRequired(index: number): number | null {
    for (let i = index + 1; i < this.steps.length; i++) if (this.required[i]!.length > 0) return i;
    return null;
  }

  private findAhead(midi: number): number | null {
    let seen = 0;
    const reach = this.reach();
    for (let i = this.position_ + 1; i < this.steps.length && seen < reach; i++) {
      const list = this.required[i]!;
      if (list.length === 0) continue;
      seen++;
      if (list.some((n) => n.midi === midi && this.state(n.id) === 'pending')) return i;
    }
    return null;
  }

  /** Leaves the current step behind; it stays open for its late notes. */
  private advance(time: number, change: FollowChange): void {
    this.open.push({ index: this.position_, until: time + this.options.grace });
    this.position_++;
    this.movedAt = time;
    change.moved = true;
    this.skipEmpty(change.changed);
  }

  /** Moves straight to a later step; everything skipped over is left open. */
  private jump(target: number, time: number, change: FollowChange): void {
    while (this.position_ < target) {
      this.open.push({ index: this.position_, until: time + this.options.grace });
      this.position_++;
    }
    this.movedAt = time;
    change.moved = true;
    this.skipEmpty(change.changed);
  }

  /** Steps with nothing to play — the other hand's — pass by themselves. */
  private skipEmpty(changed: string[]): void {
    while (this.position_ < this.steps.length && this.required[this.position_]!.length === 0) {
      for (const n of this.steps[this.position_]!.notes) {
        if (this.states.get(n.id) !== 'skipped') {
          this.states.set(n.id, 'skipped');
          changed.push(n.id);
        }
      }
      this.position_++;
    }
  }

  private expire(time: number, change: FollowChange): void {
    if (this.candidate && time - this.candidate.time >= 2.5) this.candidate = null;
    const keep: Open[] = [];
    for (const o of this.open) {
      if (o.until > time) {
        keep.push(o);
        continue;
      }
      const list = this.required[o.index] ?? [];
      // Through a microphone, a chord heard as a whole was played as a whole.
      const heardAsChord =
        this.options.input === 'audio' && list.some((n) => this.state(n.id) === 'hit') && this.complete(o.index);
      for (const n of list) {
        if (this.state(n.id) === 'pending') {
          this.states.set(n.id, heardAsChord ? 'unsure' : 'missed');
          change.changed.push(n.id);
        }
      }
    }
    this.open = keep;
  }
}
