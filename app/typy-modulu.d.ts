/** Verovio typy nedodava; potrebujeme z nej jen ctyri metody. */
declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(modul: unknown);
    setOptions(volby: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(strana: number): string;
    getVersion(): string;
  }
}

declare module '*.css';
