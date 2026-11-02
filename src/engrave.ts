import type { ScoreStep } from './core/follow.js';
import { buildSteps, readMeiFacts, type TimemapEntry } from './core/score.js';

/**
 * Engraving a score for playing from a screen. Verovio does the engraving;
 * this only asks it for pages exactly as wide as the window and exactly one
 * line of music tall, so the window can stack, swap and scroll the lines
 * freely, and reads off the chain of steps the follower walks along.
 */

/** The part of Verovio's toolkit used here. */
export interface Toolkit {
  setOptions: (options: Record<string, unknown>) => void;
  loadData: (data: string) => boolean;
  loadZipDataBuffer: (data: ArrayBuffer) => boolean;
  redoLayout: (options?: Record<string, unknown>) => void;
  getPageCount: () => number;
  renderToSVG: (page: number) => string;
  renderToTimemap: (options?: Record<string, unknown>) => TimemapEntry[];
  getMIDIValuesForElement: (id: string) => { pitch?: number } | null;
  getPageWithElement: (id: string) => number;
  getMEI: (options?: Record<string, unknown>) => string;
}

/** A score engraved for the window: one line of music per entry. */
export interface ScreenLayout {
  title: string;
  systems: { svg: string; width: number; height: number }[];
  steps: ScoreStep[];
  /** Staff numbers that hold notes, from the top. */
  staves: number[];
}

/** Verovio options for lines `width` pixels wide at a given scale (percent). */
export function screenOptions(width: number, scale: number): Record<string, unknown> {
  const safeScale = Math.max(20, Math.min(120, Math.round(scale)));
  return {
    // Page sizes are in tenths of a millimetre at 100 %, so the scale divides.
    pageWidth: Math.max(600, Math.round((Math.max(320, width) * 100) / safeScale)),
    pageHeight: 60000,
    adjustPageHeight: true,
    systemMaxPerPage: 1,
    scale: safeScale,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    pageMarginTop: 40,
    pageMarginBottom: 40,
    pageMarginLeft: 60,
    pageMarginRight: 60,
    spacingStaff: 8,
    // Repeats are played as written on the page; expanding them would send
    // the follower back and forth between lines the reader does not expect.
    expandNever: true,
    svgAdditionalAttribute: ['staff@n'],
  };
}

/**
 * Lays out data already loaded into the toolkit. `fresh` loads it first;
 * otherwise the layout is only redone, which keeps every element's id.
 */
export function layoutForScreen(
  toolkit: Toolkit,
  title: string,
  width: number,
  scale: number,
  data: string | ArrayBuffer | null,
): ScreenLayout {
  toolkit.setOptions(screenOptions(width, scale));
  if (data !== null) {
    const ok = typeof data === 'string' ? toolkit.loadData(data) : toolkit.loadZipDataBuffer(data);
    if (!ok) throw new Error('Tyhle noty se nepodařilo načíst.');
  } else {
    toolkit.redoLayout();
  }

  const systems: ScreenLayout['systems'] = [];
  for (let page = 1; page <= toolkit.getPageCount(); page++) {
    const svg = toolkit.renderToSVG(page);
    const size = /<svg[^>]*\bwidth="([\d.]+)px"[^>]*\bheight="([\d.]+)px"/.exec(svg);
    systems.push({ svg, width: Number(size?.[1] ?? width), height: Number(size?.[2] ?? 200) });
  }
  const timemap = toolkit.renderToTimemap({ includeMeasures: false });
  const steps = buildSteps(timemap, {
    pitch: (id) => toolkit.getMIDIValuesForElement(id)?.pitch ?? null,
    system: (id) => Math.max(0, toolkit.getPageWithElement(id) - 1),
    facts: readMeiFacts(toolkit.getMEI()),
  });
  const staves = [...new Set(steps.flatMap((s) => s.notes.map((n) => n.staff)))].sort((a, b) => a - b);
  return { title, systems, steps, staves };
}
