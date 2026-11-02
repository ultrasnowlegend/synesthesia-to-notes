/**
 * What happened on earlier runs through a piece, kept in the window's own
 * storage: enough to show progress and to find the measures that keep going
 * wrong. Nothing leaves the computer.
 */

export interface Run {
  /** When it ended, as milliseconds since 1970. */
  at: number;
  hit: number;
  missed: number;
  /** Chord notes the microphone could not pick out; not counted either way. */
  unsure?: number;
  wrong: number;
  total: number;
  seconds: number;
  hands: string;
  input: string;
  /** Measures (numbered from 1) with their mistakes, worst first, at most five. */
  trouble: { measure: number; mistakes: number }[];
}

const KEY = 'practice-history';
const LIMIT = 30;

type Store = Record<string, Run[]>;

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

export function runsOf(piece: string): Run[] {
  return read()[piece] ?? [];
}

export function addRun(piece: string, run: Run): Run[] {
  const store = read();
  const runs = [...(store[piece] ?? []), run].slice(-LIMIT);
  store[piece] = runs;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // A full storage only costs the history.
  }
  return runs;
}

/**
 * Share of the judged notes that were played, 0..100. Wrong notes count
 * against it; notes not reached yet and notes the microphone was unsure of
 * do not count at all.
 */
export function accuracy(run: Pick<Run, 'hit' | 'missed' | 'wrong'>): number {
  const judged = run.hit + run.missed + run.wrong;
  if (judged === 0) return 0;
  return Math.max(0, Math.round((run.hit / judged) * 100));
}

export interface Recent {
  path: string;
  title: string;
  at: number;
}

const RECENT = 'recent-scores';

export function recentScores(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as Recent[];
  } catch {
    return [];
  }
}

export function rememberScore(path: string, title: string): void {
  const list = [{ path, title, at: Date.now() }, ...recentScores().filter((r) => r.path !== path)].slice(0, 8);
  try {
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch {
    // Not remembered this time.
  }
}

export function forgetScore(path: string): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify(recentScores().filter((r) => r.path !== path)));
  } catch {
    // Nothing to do.
  }
}
