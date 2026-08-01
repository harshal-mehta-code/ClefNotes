/// <reference types="vite/client" />

// Verovio ships WASM + ESM builds with no bundled types.
declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): number;
    getPageCount(): number;
    renderToSVG(page: number): string;
    renderToTimemap(options: Record<string, unknown>): Array<{
      tstamp: number;
      qstamp: number;
      tempo?: number;
      measureOn?: string;
      on?: string[];
      off?: string[];
    }>;
    getElementAttr(id: string): Record<string, string>;
    getMIDIValuesForElement(id: string): { duration: number; pitch: number; time: number };
    getTimeForElement(id: string): number;
    renderToMIDI(): string;
  }
}
