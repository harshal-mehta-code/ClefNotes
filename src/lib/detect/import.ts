import { findStaves, readPage, toBitmap } from './notes';
import { renderPhoto } from './photo';
import { readVectorHeads } from './vector';
import { DEFAULT_PARTS } from './types';
import type { DetectedNote, DetectedStaff, PageScore, ScorePage } from './types';

/**
 * Turning whatever you have into a readable, clickable score.
 *
 * A PDF, a photo of the music on the stand, a scan in your camera roll — they
 * all end in the same place: a picture of a page, and the staves and noteheads
 * found in its coordinates. The picture is the product, not an intermediate
 * step. You look at your own sheet music and the app only adds the ability to
 * hear it, so it is kept at a resolution worth reading, and pages are handled
 * one at a time and released — a page at this size is ~30 MB of pixels and
 * holding a whole score at once is enough for a phone to kill the tab.
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

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f: File) =>
  f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);

/** One page, rendered and read. */
interface Rendered {
  canvas: HTMLCanvasElement;
  /** Photographs need the thresholder that copes with uneven light. */
  local: boolean;
  /**
   * The page itself, still open, when it is a PDF — so the noteheads can be
   * read out of the file's glyphs instead of out of the picture of them.
   */
  page?: any;
  viewport?: { transform: number[] };
}

/**
 * Import a PDF, or one or more images.
 *
 * Several photos become several pages of one score, because sheet music is
 * rarely one page and photographing it a page at a time is how anyone would do
 * it. Mixing a PDF in with them is refused rather than guessed at.
 */
export async function importScore(files: File[], onProgress?: ImportProgress): Promise<PageScore> {
  const usable = files.filter((f) => isPdf(f) || isImage(f));
  if (!usable.length) {
    throw new Error(
      'ClefNotes opens PDFs and pictures of sheet music. That file is neither — try a PDF, or a photo of the page.',
    );
  }
  const pdfs = usable.filter(isPdf);
  if (pdfs.length && pdfs.length !== usable.length) {
    throw new Error('Import a PDF on its own, or photos on their own — not both at once.');
  }
  if (pdfs.length > 1) throw new Error('One PDF at a time, please.');

  const title =
    (usable.length > 1 ? 'Sheet music' : usable[0].name.replace(/\.[^.]+$/, ''))
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled score';

  return assemble(
    pdfs.length ? renderPdf(pdfs[0], onProgress) : renderPhotos(usable, onProgress),
    title,
    pdfs.length ? 'PDF' : 'picture',
  );
}

async function* renderPhotos(files: File[], onProgress?: ImportProgress): AsyncGenerator<Rendered> {
  for (let i = 0; i < files.length; i++) {
    onProgress?.(
      files.length > 1 ? `Reading picture ${i + 1} of ${files.length}…` : 'Reading…',
      i / files.length,
    );
    await new Promise((r) => setTimeout(r, 0));
    yield { canvas: await renderPhoto(files[i]), local: true };
  }
}

async function* renderPdf(file: File, onProgress?: ImportProgress): AsyncGenerator<Rendered> {
  const lib = await pdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  if (!count) throw new Error('That PDF has no pages ClefNotes could open.');

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
    // Rendered before the glyphs are read, and only cleaned up after: drawing
    // the page is what makes the browser load its embedded fonts, and reading
    // a notehead's shape out of one means having it installed.
    await page.render({ canvasContext: ctx, viewport }).promise;

    yield { canvas, local: false, page, viewport };
    page.cleanup();
  }
}

/** Read each page as it arrives, and let go of it before taking the next. */
async function assemble(
  source: AsyncGenerator<Rendered>,
  title: string,
  kind: string,
): Promise<PageScore> {
  const pages: ScorePage[] = [];
  const staves: DetectedStaff[] = [];
  const notes: DetectedNote[] = [];

  for await (const { canvas, local, page, viewport } of source) {
    const index = pages.length;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Where the noteheads are, from the file, if this is a file that says. The
    // staves have to be found first either way, and are found twice for a PDF
    // — the second time inside `readPage`. It costs a few tens of milliseconds
    // against the seconds the glyph path saves, and it keeps `readPage` a
    // single function anyone can follow.
    let heads = null;
    if (page && viewport) {
      try {
        heads = await readVectorHeads(page, viewport, findStaves(toBitmap(image, local)));
      } catch {
        heads = null;
      }
    }

    const reading = readPage(image, index, local, heads);
    staves.push(...reading.staves);
    notes.push(...reading.notes);
    pages.push({
      index,
      image: canvas.toDataURL('image/jpeg', 0.82),
      width: canvas.width,
      height: canvas.height,
    });
    // Release the page before rendering the next one.
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!staves.length) {
    throw new Error(
      kind === 'PDF'
        ? 'No staves were found in that PDF. ClefNotes reads printed sheet music; handwriting will not come through.'
        : 'No staves were found in that picture. Photograph the page square-on and filling the frame, in even light, with the music in focus — a page at an angle or half in shadow will not read.',
    );
  }

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
    alters: {},
    parts: DEFAULT_PARTS.map((p) => ({ ...p })),
    partOf: {},
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
