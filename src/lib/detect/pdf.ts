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

  inheritKeys(staves);

  return {
    id: `score-${Date.now().toString(36)}`,
    title,
    addedAt: Date.now(),
    openedAt: Date.now(),
    pages,
    staves,
    notes,
    sharps: commonKey(staves),
    nudges: {},
  };
}

/**
 * Give staves whose key signature could not be read the key that is in force
 * there.
 *
 * This is not a patch over the detector — it is how the notation works. A key
 * signature holds until it is changed, and engravers reprint it on every system
 * as a courtesy. So a staff that could not be read shares its system's key, and
 * failing that, carries on with the key of the system before it. Only a stretch
 * at the very start with nothing readable anywhere is left unknown.
 */
function inheritKeys(staves: DetectedStaff[]): void {
  // Staves of one system are braced together and always share a key.
  const systems = new Map<string, DetectedStaff[]>();
  for (const s of staves) {
    const id = `${s.page}:${s.system}`;
    if (!systems.has(id)) systems.set(id, []);
    systems.get(id)!.push(s);
  }
  for (const group of systems.values()) {
    const read = group.find((s) => s.sharps != null);
    if (read) for (const s of group) s.sharps = read.sharps;
  }

  // Then forwards through the score, and backwards for anything before the
  // first staff that could be read.
  let carried: number | null = null;
  for (const s of staves) {
    if (s.sharps == null) s.sharps = carried;
    else carried = s.sharps;
  }
  carried = null;
  for (let i = staves.length - 1; i >= 0; i--) {
    if (staves[i].sharps == null) staves[i].sharps = carried;
    else carried = staves[i].sharps;
  }

  // Nothing readable anywhere. A score with no key signature printed on it is
  // in C, and a score whose signatures could not be read has to start
  // somewhere — either way this is the answer to correct from, and leaving the
  // field empty would only push the same assumption further downstream.
  for (const s of staves) if (s.sharps == null) s.sharps = 0;
}

/**
 * The score's key: whichever one most staves were read as. It is the fallback
 * for staves whose key could not be read, so the commonest reading is the
 * safest guess — and on a score that changes key, the staves that did read
 * carry their own.
 */
function commonKey(staves: DetectedStaff[]): number {
  const tally = new Map<number, number>();
  for (const s of staves) {
    if (s.sharps == null) continue;
    tally.set(s.sharps, (tally.get(s.sharps) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [sharps, n] of tally) {
    if (n > bestCount) {
      best = sharps;
      bestCount = n;
    }
  }
  return best;
}
