/**
 * The browser half of `scripts/detect.mjs`. Loaded through the Vite dev server
 * so that it sees exactly the modules the app ships, rather than a copy of them
 * that could drift. Not part of the app bundle.
 */

import * as lib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readPage, toBitmap, findStaves, removeStaffLines, findTextBands } from '../src/lib/detect/notes';

lib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(b64: string) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await lib.getDocument({ data: bin }).promise;
  const pages = [];

  for (let i = 0; i < Math.min(doc.numPages, 24); i++) {
    const pdfPage = await doc.getPage(i + 1);
    const scale = Math.min(4, Math.max(1.5, 2200 / pdfPage.getViewport({ scale: 1 }).width));
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
    pdfPage.cleanup();

    const t0 = performance.now();
    const reading = readPage(ctx.getImageData(0, 0, canvas.width, canvas.height), i, false);

    const bm0 = toBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height), false);
    const staves0 = findStaves(bm0);
    const bands = findTextBands(removeStaffLines(bm0, staves0), staves0);
    for (const [a, b] of bands) {
      ctx.fillStyle = 'rgba(255,180,0,0.25)';
      ctx.fillRect(0, a, canvas.width, b - a);
    }

    // Ring every notehead the reader believes in, hollow ones in a second
    // colour, so a miss and a mis-read look different at a glance.
    for (const s of reading.staves) {
      ctx.strokeStyle = 'rgba(0,140,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.left, s.top, s.right - s.left, s.bottom - s.top);
    }
    for (const n of reading.notes) {
      const s = reading.staves.find((v) => v.id === n.staff);
      const r = (s?.spacing ?? 8) * 0.8;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = n.filled ? 'rgba(220,0,0,0.9)' : 'rgba(0,150,50,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    pages.push({
      index: i,
      ms: Math.round(performance.now() - t0),
      bands,
      png: canvas.toDataURL('image/png'),
      staves: reading.staves.map((s) => ({
        id: s.id,
        system: s.system,
        positionInSystem: s.positionInSystem,
        clef: s.clef,
        sharps: s.sharps,
        spacing: Math.round(s.spacing * 10) / 10,
        top: Math.round(s.top),
      })),
      notes: reading.notes.map((n) => ({
        staff: n.staff,
        x: Math.round(n.x),
        y: Math.round(n.y),
        step: n.step,
        filled: n.filled,
        accidental: n.accidental,
      })),
    });
    canvas.width = 0;
    canvas.height = 0;
  }
  return pages;
}

/** The page as the reader sees it after the staff lines are erased. */
export async function cleanPdf(b64: string, pageIndex: number) {
  const { toBitmap, findStaves, removeStaffLines } = await import('../src/lib/detect/notes');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await lib.getDocument({ data: bin }).promise;
  const pdfPage = await doc.getPage(pageIndex + 1);
  const scale = Math.min(4, Math.max(1.5, 2200 / pdfPage.getViewport({ scale: 1 }).width));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bm = toBitmap(image, false);
  const clean = removeStaffLines(bm, findStaves(bm));
  const out = ctx.createImageData(canvas.width, canvas.height);
  for (let p = 0; p < clean.data.length; p++) {
    const v = clean.data[p] ? 0 : 255;
    out.data[p * 4] = out.data[p * 4 + 1] = out.data[p * 4 + 2] = v;
    out.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}
