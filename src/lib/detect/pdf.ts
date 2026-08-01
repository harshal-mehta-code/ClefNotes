import { readPage } from './notes';
import type { DetectedNote, DetectedStaff, PageScore, ScorePage } from './types';

/**
 * Turning a PDF into a readable, clickable score.
 *
 * The rendered page is the product, not an intermediate step — you look at your
 * own sheet music, and the app only adds the ability to hear it. So the image
 * is kept at a resolution worth reading, and pages are processed one at a time
 * and released, because a page at this size is ~30 MB of pixels and holding a
 * whole score would be enough for a phone to kill the tab.
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

/** Recognition needs the detail; beyond this it only costs memory. */
const TARGET_WIDTH = 2200;
const MAX_PAGES = 24;

export interface ImportProgress {
  (label: string, fraction: number): void;
}

export async function importPdf(
  file: File,
  onProgress?: ImportProgress,
): Promise<PageScore> {
  const lib = await pdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  if (!count) throw new Error('That PDF has no pages ClefNotes could open.');

  const pages: ScorePage[] = [];
  const staves: DetectedStaff[] = [];
  const notes: DetectedNote[] = [];

  for (let i = 0; i < count; i++) {
    onProgress?.(`Reading page ${i + 1} of ${count}…`, i / count);
    await new Promise((r) => setTimeout(r, 0));

    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(1.5, TARGET_WIDTH / base.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const reading = readPage(imageData, i);
    staves.push(...reading.staves);
    notes.push(...reading.notes);

    pages.push({
      index: i,
      image: canvas.toDataURL('image/jpeg', 0.82),
      width: canvas.width,
      height: canvas.height,
    });

    // Release the page before rendering the next one.
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }

  if (!staves.length) {
    throw new Error(
      'No staves were found in that PDF. ClefNotes reads clean, printed sheet music — a photo, a scan that is skewed or faint, or handwriting will not come through.',
    );
  }

  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled score';

  return {
    id: `score-${Date.now().toString(36)}`,
    title,
    addedAt: Date.now(),
    openedAt: Date.now(),
    pages,
    staves,
    notes,
    sharps: 0,
    nudges: {},
  };
}
