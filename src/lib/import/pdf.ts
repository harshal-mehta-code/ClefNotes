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

/**
 * Recognition is slow and memory-hungry, and accuracy does not improve with
 * length. Twelve pages covers most single movements; beyond that the import
 * says what it skipped rather than grinding a phone to a halt.
 */
const MAX_OMR_PAGES = 12;

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
  /** A small JPEG of the page, shown next to the recognised result. */
  preview: string;
  width: number;
  height: number;
}

type PdfDoc = Awaited<ReturnType<typeof import('pdfjs-dist').getDocument>['promise']>;

/**
 * Render one page.
 *
 * Staff spacing in pixels is the unit every OMR measurement is expressed in, so
 * resolution directly limits how well shapes can be told apart. ~2400px across
 * a page puts a typical staff space above 15px, which is where notehead
 * detection starts working.
 *
 * Each page is ~30 MB of ImageData. They are produced on demand and released
 * before the next one, because holding a seven-page score in memory at once is
 * a couple of hundred megabytes — enough for a phone to kill the tab, which is
 * exactly what "nothing happens on my phone" looks like.
 */
async function renderPage(
  doc: PdfDoc,
  index: number,
): Promise<{ image: ImageData; preview: string; width: number; height: number } | null> {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4.5, Math.max(1.8, 2400 / base.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL('image/jpeg', 0.6);
  // Let the canvas go immediately rather than waiting on the collector.
  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();
  return { image, preview, width: viewport.width, height: viewport.height };
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

  onProgress?.('No embedded score inside. Reading the pages…');
  const count = Math.min(doc.numPages, MAX_OMR_PAGES);
  if (!count) throw new Error('That PDF has no pages ClefNotes could render.');

  const previews: RasterPage[] = [];
  const { recognise } = await import('./omr');
  const result = await recognise(
    count,
    async (i) => {
      onProgress?.(`Reading page ${i + 1} of ${count}…`);
      const rendered = await renderPage(doc, i);
      if (!rendered) throw new Error(`Page ${i + 1} could not be rendered.`);
      previews.push({ preview: rendered.preview, width: rendered.width, height: rendered.height });
      return rendered.image;
    },
    { onProgress: (label) => onProgress?.(label) },
  );

  const truncated = doc.numPages > count;
  return {
    musicXml: result.musicXml,
    source: 'omr',
    pages: previews,
    confidence: result.confidence,
    note:
      `Read ${result.noteCount} notes across ${result.staffCount} part${result.staffCount === 1 ? '' : 's'}` +
      (truncated ? `, from the first ${count} of ${doc.numPages} pages` : '') +
      `. Check it against the original — recognition is a draft, not a transcription.`,
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
