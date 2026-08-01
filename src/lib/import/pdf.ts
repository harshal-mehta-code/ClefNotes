import type { ImportResult } from './files';
import { unzipFirstXml } from './files';

/**
 * PDF import, in three tiers, cheapest and most accurate first.
 *
 *   Tier 1 — the PDF has a real score attached. MuseScore embeds the .mxl it
 *            exported from, and other editors attach MusicXML too. When that's
 *            there the import is *perfect* and instant, and nobody has to look
 *            at a pixel. Always try this first.
 *   Tier 2 — rasterise the pages and run the built-in OMR over them.
 *   Tier 3 — tell the user plainly what happened and what to try instead.
 */

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    })();
  }
  return pdfjsPromise;
}

const XML_SNIFF = /<score-partwise|<score-timewise|<mei\b/i;

/** Tier 1: pull an embedded MusicXML attachment out of the PDF. */
async function extractEmbedded(doc: {
  getAttachments(): Promise<Record<string, { filename: string; content: Uint8Array }> | null>;
}): Promise<string | null> {
  let attachments: Record<string, { filename: string; content: Uint8Array }> | null = null;
  try {
    attachments = await doc.getAttachments();
  } catch {
    return null;
  }
  if (!attachments) return null;

  for (const entry of Object.values(attachments)) {
    const name = (entry.filename ?? '').toLowerCase();
    const bytes = entry.content;
    if (!bytes?.length) continue;

    // A .mxl attachment is a zip; PK is its magic number.
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    try {
      if (name.endsWith('.mxl') || isZip) {
        const copy = bytes.slice();
        const xml = await unzipFirstXml(
          copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer,
        );
        if (XML_SNIFF.test(xml)) return xml;
      } else if (name.endsWith('.xml') || name.endsWith('.musicxml') || name.endsWith('.mei')) {
        const text = new TextDecoder().decode(bytes);
        if (XML_SNIFF.test(text)) return text;
      }
    } catch {
      /* try the next attachment */
    }
  }
  return null;
}

export interface RasterPage {
  image: ImageData;
  /** A data URL of the page, shown next to the recognised result. */
  preview: string;
  width: number;
  height: number;
}

/** Rasterise pages at a resolution high enough for the OMR to measure staves. */
export async function rasterise(
  file: File,
  onProgress?: (label: string) => void,
  maxPages = 8,
): Promise<RasterPage[]> {
  const lib = await pdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pages: RasterPage[] = [];
  const count = Math.min(doc.numPages, maxPages);

  for (let i = 1; i <= count; i++) {
    onProgress?.(`Rendering page ${i} of ${count}…`);
    const page = await doc.getPage(i);
    // Staff spacing in pixels is the unit every OMR measurement is expressed
    // in, so resolution directly limits how well shapes can be told apart.
    // ~2400px across a page puts a typical staff space at 20px or more, which
    // is where notehead-versus-letter discrimination starts working.
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4.5, Math.max(1.8, 2400 / base.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    pages.push({
      image: ctx.getImageData(0, 0, canvas.width, canvas.height),
      preview: canvas.toDataURL('image/jpeg', 0.72),
      width: canvas.width,
      height: canvas.height,
    });
  }
  return pages;
}

export interface PdfImportResult extends ImportResult {
  /** Set when the score came from an embedded attachment — a perfect import. */
  exact?: boolean;
  pages?: RasterPage[];
  confidence?: number;
}

export async function importPdf(
  file: File,
  onProgress?: (label: string) => void,
): Promise<PdfImportResult> {
  const lib = await pdfjs();
  const buf = await file.arrayBuffer();

  onProgress?.('Looking for an embedded score…');
  const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
  const embedded = await extractEmbedded(doc);
  if (embedded) {
    return {
      musicXml: embedded,
      source: 'pdf-embedded',
      exact: true,
      note: 'This PDF had a real score attached inside it, so the import is exact — no recognition needed.',
    };
  }

  onProgress?.('No embedded score. Rendering pages for recognition…');
  const pages = await rasterise(file, onProgress);
  if (!pages.length) throw new Error('That PDF has no pages ClefNotes could render.');

  const { recognise } = await import('./omr');
  const result = await recognise(
    pages.map((p) => p.image),
    { onProgress: (label) => onProgress?.(label) },
  );

  return {
    musicXml: result.musicXml,
    source: 'omr',
    pages,
    confidence: result.confidence,
    note: `Recognised ${result.noteCount} notes across ${result.staffCount} part${
      result.staffCount === 1 ? '' : 's'
    }. Check it against the original before you trust it — recognition is never perfect.`,
  };
}

/**
 * Import from a URL.
 *
 * The browser's same-origin policy means an arbitrary link often can't be
 * fetched from a static site, and there is no server here to proxy it. So this
 * tries, and when it can't, it says exactly what to do instead rather than
 * failing mysteriously.
 */
export async function fetchScoreFromUrl(
  url: string,
  onProgress?: (label: string) => void,
): Promise<File> {
  onProgress?.('Fetching…');
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors' });
  } catch {
    throw new Error(
      "That site doesn't allow other pages to read its files (a CORS restriction), and ClefNotes has no server to fetch it for you. Download the file and drop it here instead — it'll import in one step.",
    );
  }
  if (!response.ok) {
    throw new Error(`The link returned ${response.status}. Check the address, or download the file and drop it here.`);
  }
  const blob = await response.blob();
  const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'score');
  return new File([blob], name.includes('.') ? name : `${name}.pdf`, { type: blob.type });
}
