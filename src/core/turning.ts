/**
 * Which lines of music the screen shows while the player moves through them.
 *
 * A paper page is turned too late by its nature: the last line has to be
 * played while the eyes already need the first line of the next page. A
 * screen can do better, and offers three ways:
 *
 * - "lines" — the screen holds a fixed number of slots, and every line keeps
 *   its slot. When the player moves on to the next line, the line just
 *   finished is replaced by the next one not yet shown. The line being played
 *   never moves and the next one is always visible — the half-page turn of
 *   forScore and MobileSheets, taken to its conclusion.
 * - "pages" — whole screens, turned when the player is half-way through the
 *   last line, and turned so that this line becomes the first of the new
 *   screen: nothing disappears while it is being played.
 * - "scroll" — one continuous strip kept so the current line sits near the top.
 */

export type TurnMode = 'lines' | 'pages' | 'scroll';

/**
 * Lines in their slots: entry i of the result is the line shown in slot i, or
 * -1 for an empty slot past the end. The line being played and the ones after
 * it fill the slots, each in the slot given by its number modulo the count.
 */
export function lineSlots(current: number, slots: number, total: number): number[] {
  const count = Math.max(1, slots);
  const out = new Array<number>(count).fill(-1);
  for (let line = current; line < Math.min(total, current + count); line++) {
    out[line % count] = line;
  }
  // At the very end, finished lines may stay instead of empty slots.
  for (let line = current - 1; line >= Math.max(0, current - count); line--) {
    if (out[line % count] === -1) out[line % count] = line;
  }
  return out;
}

/**
 * The first line of the screen in "pages" mode. `fits(start)` says how many
 * lines fit on a screen beginning with line `start`; `progress` is how far
 * the player is through the current line, 0..1.
 */
export function pageStart(
  previous: number,
  current: number,
  progress: number,
  fits: (start: number) => number,
  total: number,
  turnAt = 0.5,
): number {
  let start = Math.max(0, Math.min(previous, Math.max(0, total - 1)));
  const count = (s: number): number => Math.max(1, fits(s));
  // The player is no longer on the screen: back to a screen holding them.
  if (current < start) {
    start = 0;
    while (start + count(start) <= current) start += count(start);
    return start;
  }
  while (current >= start + count(start)) start += count(start);
  const last = start + count(start) - 1;
  // Half-way through the last line, turn — keeping that line on top.
  if (current === last && last < total - 1 && progress >= turnAt && count(start) > 1) return current;
  return start;
}
