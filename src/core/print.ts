/**
 * Turning engraved pages into something printable.
 *
 * Producing a PDF needs a browser engine, which the library itself does not
 * have. What it can do is lay the pages out as one self-contained HTML file;
 * whoever has a browser window — the desktop app, or a host application
 * embedding it — only has to load that file and print it. The engraving stays
 * in one place and the hosts share five lines instead of a second layout engine.
 */

export interface PrintOptions {
  /** Paper size; anything CSS accepts for `@page size`. */
  paper?: string;
  title?: string;
}

export function printableHtml(pages: readonly string[], options: PrintOptions = {}): string {
  const paper = options.paper ?? 'A4';
  const title = (options.title ?? 'Score').replace(/[<&]/g, '');
  const [width, height] = paper === 'A4' ? ['210mm', '297mm'] : ['216mm', '279mm'];

  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${title}</title>`,
    '<style>',
    `  @page { size: ${paper}; margin: 0 }`,
    '  html, body { margin: 0; padding: 0; background: #fff }',
    `  .page { width: ${width}; height: ${height}; page-break-after: always; overflow: hidden }`,
    '  .page:last-child { page-break-after: auto }',
    '  .page svg { width: 100%; height: 100% }',
    '</style>',
    ...pages.map((p) => `<div class="page">${p}</div>`),
  ].join('\n');
}
