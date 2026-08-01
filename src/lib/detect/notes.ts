import type { Alter, ClefId, DetectedNote, DetectedStaff } from './types';

/**
 * Reading a page.
 *
 * Two things, and only two: where the staves are, and where the noteheads are.
 * Everything the app does follows from those, because pitch is pure geometry
 * once you know the staff lines — the distance from the bottom line, divided by
 * half the line spacing.
 *
 * There is no attempt to read durations, voices, beams, ties or bars. That was
 * the previous design and it is where the errors lived: those features are hard
 * to see and impossible to verify, and getting them wrong changes the music.
 * Position and pitch are easy to see and, crucially, easy for you to check —
 * the note you click is a note you can see on your own page.
 */

export interface Bitmap {
  w: number;
  h: number;
  /** 1 = ink, 0 = paper. */
  data: Uint8Array;
}

// --- threshold -------------------------------------------------------------

export function toBitmap(image: ImageData): Bitmap {
  const { width: w, height: h, data } = image;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }

  // Otsu: the threshold that best separates ink from paper.
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  const out = new Uint8Array(w * h);
  for (let p = 0; p < gray.length; p++) out[p] = gray[p] < threshold ? 1 : 0;
  return { w, h, data: out };
}

const ink = (bm: Bitmap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < bm.w && y < bm.h && bm.data[y * bm.w + x] === 1;

// --- staff lines -----------------------------------------------------------

export interface RawStaff {
  lines: number[];
  spacing: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function findStaves(bm: Bitmap): RawStaff[] {
  const { w, h, data } = bm;
  const rowInk = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) count += data[row + x];
    rowInk[y] = count;
  }

  let maxInk = 0;
  for (let y = 0; y < h; y++) maxInk = Math.max(maxInk, rowInk[y]);
  if (maxInk < w * 0.2) return [];
  const cut = maxInk * 0.42;

  const centres: number[] = [];
  let runStart = -1;
  for (let y = 0; y < h; y++) {
    const isLine = rowInk[y] >= cut;
    if (isLine && runStart < 0) runStart = y;
    else if (!isLine && runStart >= 0) {
      centres.push((runStart + y - 1) / 2);
      runStart = -1;
    }
  }
  if (runStart >= 0) centres.push((runStart + h - 1) / 2);

  const staves: RawStaff[] = [];
  for (let i = 0; i + 4 < centres.length; ) {
    const group = centres.slice(i, i + 5);
    const gaps: number[] = [];
    for (let k = 1; k < 5; k++) gaps.push(group[k] - group[k - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const even = gaps.every((g) => Math.abs(g - mean) <= Math.max(1.6, mean * 0.34));
    if (even && mean >= 3 && mean <= 40) {
      const midY = Math.round(group[2]);
      let left = w;
      let right = 0;
      for (let x = 0; x < w; x++) {
        if (data[midY * w + x]) {
          if (x < left) left = x;
          right = x;
        }
      }
      staves.push({
        lines: group,
        spacing: mean,
        top: group[0],
        bottom: group[4],
        left: Math.max(0, left),
        right: Math.min(w - 1, right),
      });
      i += 5;
    } else {
      i += 1;
    }
  }
  return staves;
}

/**
 * Group staves into systems.
 *
 * Staves braced together are joined by a barline running through the gap
 * between them; staves in different systems have blank paper there. Measuring
 * the size of the gap instead does not work — in choral music the space within
 * a system and between systems are near enough identical.
 */
export function groupSystems(clean: Bitmap, staves: RawStaff[]): number[][] {
  const joined = (upper: RawStaff, lower: RawStaff): boolean => {
    const top = Math.round(upper.bottom) + 1;
    const bottom = Math.round(lower.top) - 1;
    if (bottom <= top) return true;
    const height = bottom - top;
    const sp = upper.spacing;
    for (let dx = -Math.round(sp * 1.2); dx <= 2; dx++) {
      const x = Math.round(upper.left) + dx;
      if (x < 0 || x >= clean.w) continue;
      let filled = 0;
      for (let y = top; y <= bottom; y++) if (clean.data[y * clean.w + x]) filled++;
      if (filled >= height * 0.8) return true;
    }
    return false;
  };

  const groups: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < staves.length; i++) {
    if (!current.length) current.push(i);
    else if (joined(staves[current[current.length - 1]], staves[i])) current.push(i);
    else {
      groups.push(current);
      current = [i];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

// --- staff-line removal ----------------------------------------------------

export function removeStaffLines(bm: Bitmap, staves: RawStaff[]): Bitmap {
  const { w, h, data } = bm;
  const out = new Uint8Array(data);
  const thickness = Math.max(1, Math.round(staves[0] ? staves[0].spacing / 4.5 : 2));

  for (const staff of staves) {
    for (const lineY of staff.lines) {
      const y0 = Math.round(lineY);
      for (let x = staff.left; x <= staff.right; x++) {
        // Erase only where the ink is thin. Where a stem or notehead crosses
        // the line the run is tall, and that has to survive.
        let up = 0;
        let down = 0;
        while (up < thickness * 4 && y0 - up - 1 >= 0 && data[(y0 - up - 1) * w + x]) up++;
        while (down < thickness * 4 && y0 + down + 1 < h && data[(y0 + down + 1) * w + x]) down++;
        if (up + down + 1 <= thickness * 2 + 1) {
          for (let y = y0 - up; y <= y0 + down; y++) if (y >= 0 && y < h) out[y * w + x] = 0;
        }
      }
    }
  }
  return { w, h, data: out };
}

// --- noteheads -------------------------------------------------------------

function ellipseInk(bm: Bitmap, cx: number, cy: number, rx: number, ry: number): number {
  let hits = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(bm.w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(bm.h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      if (dx * dx + dy * dy > 1) continue;
      total++;
      hits += bm.data[y * bm.w + x];
    }
  }
  return total ? hits / total : 0;
}

function run(bm: Bitmap, cx: number, cy: number, dx: number, dy: number, max: number): number {
  let n = 0;
  let x = cx;
  let y = cy;
  while (n < max) {
    x += dx;
    y += dy;
    if (!ink(bm, x, y)) break;
    n++;
  }
  return n;
}

function gapThenStroke(
  bm: Bitmap,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  maxGap: number,
  maxStroke: number,
): { gap: number; stroke: number } | null {
  let gap = 0;
  let x = cx;
  let y = cy;
  while (gap < maxGap) {
    x += dx;
    y += dy;
    if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return null;
    if (bm.data[y * bm.w + x]) break;
    gap++;
  }
  if (gap >= maxGap) return null;
  let stroke = 0;
  while (stroke < maxStroke) {
    x += dx;
    y += dy;
    if (!ink(bm, x, y)) break;
    stroke++;
  }
  return { gap, stroke };
}

/**
 * Find noteheads on one staff.
 *
 * Ink density alone finds clefs, lyrics and the number 4 as well as notes. What
 * separates a notehead is its size relative to the staff — about 1.3 spaces
 * wide and one space tall, always, because that is how music is engraved. So
 * every candidate has to pass a measured run-length test, not just a dark one.
 */
export function findHeads(
  clean: Bitmap,
  staff: RawStaff,
  startX = 0,
): Array<{ x: number; y: number; step: number; filled: boolean }> {
  const sp = staff.spacing;
  const rx = sp * 0.62;
  const ry = sp * 0.46;
  const yTop = Math.max(0, Math.round(staff.top - sp * 2.6));
  const yBot = Math.min(clean.h - 1, Math.round(staff.bottom + sp * 2.6));
  // Past the clef and the key signature. A fixed distance from the left edge is
  // not enough: where a bracket joins the staves it *is* the left edge, and the
  // clef then sits inside the margin and gets read as a pair of noteheads.
  const xFrom = Math.round(Math.max(staff.left + sp * 3.2, startX));
  const stride = Math.max(1, Math.round(sp / 7));

  const minW = sp * 0.8;
  const maxW = sp * 2.05;
  const minH = sp * 0.55;
  const maxH = sp * 1.5;

  const candidates: Array<{ x: number; y: number; score: number; filled: boolean }> = [];
  for (let y = yTop; y <= yBot; y += stride) {
    for (let x = xFrom; x <= staff.right; x += stride) {
      if (ink(clean, x, y)) {
        const wide = 1 + run(clean, x, y, -1, 0, maxW) + run(clean, x, y, 1, 0, maxW);
        if (wide < minW || wide > maxW) continue;
        const tall = 1 + run(clean, x, y, 0, -1, maxH) + run(clean, x, y, 0, 1, maxH);
        if (tall < minH || tall > maxH) continue;
        if (ellipseInk(clean, x, y, rx * 0.55, ry * 0.55) < 0.9) continue;
        const whole = ellipseInk(clean, x, y, rx, ry);
        if (whole < 0.72) continue;
        candidates.push({ x, y, score: whole + 1, filled: true });
        continue;
      }

      // Hollow head: a light centre ringed by a thin stroke on every side.
      const left = gapThenStroke(clean, x, y, -1, 0, sp * 0.6, sp * 0.5);
      const right = gapThenStroke(clean, x, y, 1, 0, sp * 0.6, sp * 0.5);
      if (!left || !right || left.stroke < 1 || right.stroke < 1) continue;
      const width = left.gap + left.stroke + right.gap + right.stroke;
      if (width < minW || width > maxW) continue;
      const up = gapThenStroke(clean, x, y, 0, -1, sp * 0.5, sp * 0.4);
      const down = gapThenStroke(clean, x, y, 0, 1, sp * 0.5, sp * 0.4);
      if (!up || !down) continue;
      const height = up.gap + up.stroke + down.gap + down.stroke;
      if (height < minH || height > maxH) continue;
      if (ellipseInk(clean, x, y, rx * 0.4, ry * 0.4) > 0.22) continue;
      const whole = ellipseInk(clean, x, y, rx, ry);
      if (whole < 0.3 || whole > 0.78) continue;
      candidates.push({ x, y, score: whole, filled: false });
    }
  }

  // One detection per notehead.
  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];
  for (const c of candidates) {
    if (kept.some((k) => Math.abs(k.x - c.x) < sp * 1.15 && Math.abs(k.y - c.y) < sp * 0.85))
      continue;
    kept.push(c);
  }

  return kept
    .map((k) => ({
      x: k.x,
      y: k.y,
      // Snap to the nearest half-space: a notehead always sits on a line or in
      // a space, so rounding here removes a pixel of detection jitter.
      step: Math.round((staff.lines[4] - k.y) / (sp / 2)),
      filled: k.filled,
    }))
    .sort((a, b) => a.x - b.x);
}

// --- key signature ---------------------------------------------------------

/**
 * Where the first sharp and the first flat of a key signature are printed, as
 * half-spaces above the bottom staff line. They start in completely different
 * places — F♯ on the top line of a treble staff, B♭ on the middle line — which
 * is what makes the two readable apart by geometry rather than by shape.
 */
const SHARP_START: Record<ClefId, number> = { treble: 8, treble8: 8, bass: 6, alto: 7 };
const FLAT_START: Record<ClefId, number> = { treble: 4, treble8: 4, bass: 2, alto: 3 };
/** Each subsequent accidental steps a fourth down or a fifth up, alternating. */
const SHARP_WALK = [0, -3, 4, -3, -3, 4, -3];
const FLAT_WALK = [0, 3, -4, 3, -4, 3, -4];

function template(clef: ClefId, flat: boolean): number[] {
  const walk = flat ? FLAT_WALK : SHARP_WALK;
  let at = flat ? FLAT_START[clef] : SHARP_START[clef];
  return walk.map((d, i) => (i === 0 ? at : (at += d)));
}

interface Glyph {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Ink-bounded glyphs across the head of a staff, left to right. */
function headGlyphs(clean: Bitmap, staff: RawStaff): Glyph[] {
  const sp = staff.spacing;
  // Kept tight on purpose. Measure numbers and tempo marks are printed just
  // above the staff, often touching the key signature, and a band that reaches
  // them welds "17" onto the sharp beside it. A key signature never strays
  // more than about a space outside the staff, so nothing real is lost.
  const yTop = Math.max(0, Math.round(staff.top - sp * 1.05));
  const yBot = Math.min(clean.h - 1, Math.round(staff.bottom + sp * 1.05));
  const xFrom = Math.max(0, Math.round(staff.left) - 2);
  const xTo = Math.min(clean.w - 1, Math.round(staff.left + sp * 14), Math.round(staff.right));
  if (xTo <= xFrom) return [];

  const filled: number[] = [];
  for (let x = xFrom; x <= xTo; x++) {
    let n = 0;
    for (let y = yTop; y <= yBot; y++) if (clean.data[y * clean.w + x]) n++;
    filled.push(n);
  }

  // Split on any blank column at all. Every part of a sharp or a flat is
  // joined to the rest of it, so nothing needs bridging — and bridging costs
  // dearly here, because a flat's bowl reaches to within a pixel or two of the
  // next flat's stem, and welding those together shifts every reading along by
  // half a glyph.
  const bridge = 0;
  const spans: Array<[number, number]> = [];
  let start = -1;
  let blank = 0;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] > 0) {
      if (start < 0) start = i;
      blank = 0;
    } else if (start >= 0 && ++blank > bridge) {
      spans.push([start, i - blank]);
      start = -1;
    }
  }
  if (start >= 0) spans.push([start, filled.length - 1]);

  return spans
    .map(([a, b]) => {
      const x0 = xFrom + a;
      const x1 = xFrom + b;

      // A measure number, a slur or a tempo mark can sit directly above the
      // key signature, and taking the whole column would swallow it into the
      // glyph — which is exactly how a flat came back four staff-spaces tall.
      // So keep only the band of rows that actually belongs to the staff.
      const runs: Array<[number, number]> = [];
      const split = Math.max(1, Math.round(sp * 0.22));
      let start = -1;
      let blank = 0;
      for (let y = yTop; y <= yBot; y++) {
        let inked = false;
        for (let x = x0; x <= x1 && !inked; x++) inked = clean.data[y * clean.w + x] === 1;
        if (inked) {
          if (start < 0) start = y;
          blank = 0;
        } else if (start >= 0 && ++blank > split) {
          runs.push([start, y - blank]);
          start = -1;
        }
      }
      if (start >= 0) runs.push([start, yBot]);
      if (!runs.length) return null;

      const overlap = ([r0, r1]: [number, number]) =>
        Math.max(0, Math.min(r1, staff.bottom) - Math.max(r0, staff.top));
      const best = runs.reduce((a, r) => (overlap(r) > overlap(a) ? r : a));
      return { x0, x1, y0: best[0], y1: best[1] };
    })
    .filter((g): g is Glyph => g != null);
}

/** How far the ink reaches across each row of a glyph, in pixels. */
function rowWidths(clean: Bitmap, g: Glyph): number[] {
  const out: number[] = [];
  for (let y = g.y0; y <= g.y1; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = g.x0; x <= g.x1; x++) {
      if (clean.data[y * clean.w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    out.push(lo < 0 ? 0 : hi - lo + 1);
  }
  return out;
}

/**
 * How wide the ink runs, as a fraction of the glyph, across a horizontal band.
 *
 * Which row to take is not a detail. The *widest* row is the robust measure
 * when the glyph may be a fragment — at a staff head a flat often arrives as a
 * bare bowl, its stem having come away in the threshold, and only the widest
 * row still says "bowl". The *typical* row is what tells a whole natural from a
 * whole sharp: a natural's upper crossbar starts a quarter of the way down, so
 * by the widest row it is exactly as wide up there as a sharp is, and every
 * natural in the test score was read as a sharp until this was split in two.
 */
function bandWidth(
  clean: Bitmap,
  g: Glyph,
  from: number,
  to: number,
  stat: 'widest' | 'typical' = 'widest',
): number {
  const rows = rowWidths(clean, g);
  const a = Math.round((rows.length - 1) * from);
  const b = Math.round((rows.length - 1) * to);
  const band = rows.slice(a, b + 1);
  if (!band.length) return 0;
  const pick =
    stat === 'widest' ? Math.max(...band) : band.slice().sort((p, q) => p - q)[band.length >> 1];
  return pick / (g.x1 - g.x0 + 1);
}

/**
 * Which y a key-signature accidental actually names.
 *
 * Not the middle of the glyph: a flat is a bowl with a stem above it, and how
 * far that stem rises is a matter of house style — one engraving here draws it
 * clear above the staff, which throws any fixed fraction of the height. The
 * pitch is the middle of the *wide* part, which is the bowl of a flat and the
 * body of a sharp alike.
 */
function inkCentre(clean: Bitmap, g: Glyph): number {
  const rows = rowWidths(clean, g);
  const cut = Math.max(...rows) * 0.62;
  let first = -1;
  let last = -1;
  rows.forEach((w, i) => {
    if (w < cut) return;
    if (first < 0) first = i;
    last = i;
  });
  return first < 0 ? (g.y0 + g.y1) / 2 : g.y0 + (first + last) / 2;
}

/**
 * Which of the three accidentals a glyph is, or null for none of them.
 *
 *   sharp    two full-height strokes — ink across the whole width, top and bottom
 *   flat     a stem over a bowl      — narrow on top, wide underneath
 *   natural  two half-height strokes — narrow at both ends, full width across
 *            the middle, where the two strokes overlap
 *
 * The three are measured, not guessed at: on the score this was tuned against,
 * a sharp runs 0.50–0.71 of its width at the top where a flat or a natural runs
 * 0.08–0.20, and the gap between those is wide enough to sit a threshold in
 * without splitting hairs.
 */
function accidentalShape(clean: Bitmap, g: Glyph): Alter | null {
  const top = bandWidth(clean, g, 0, 0.26, 'typical');
  const mid = bandWidth(clean, g, 0.36, 0.64, 'typical');
  const bottom = bandWidth(clean, g, 0.74, 1, 'typical');
  const stem = 0.35; // anything above this is more than a bare vertical stroke
  if (top > stem && bottom > stem) return 1;
  // A flat's bowl runs 0.54–0.67 across the bottom quarter and a natural's
  // lone stroke 0.10–0.20, so the line between them goes in the gap.
  if (bottom > 0.4) return -1;
  return mid > 0.6 ? 0 : null;
}

/**
 * The same three shapes at the head of a staff, where a glyph is as likely to
 * be a fragment as a whole accidental — so the widest row decides, and anything
 * that is neither a sharp nor a flat is called a natural rather than rejected.
 * The key-signature walk skips naturals, which is the safe way to be unsure.
 */
function classify(clean: Bitmap, g: Glyph): 'sharp' | 'flat' | 'natural' {
  if (bandWidth(clean, g, 0, 0.26) > 0.55) return 'sharp';
  return bandWidth(clean, g, 0.74, 1) > 0.55 ? 'flat' : 'natural';
}

/**
 * Read the key signature at the head of a staff.
 *
 * Returns sharps (negative for flats), or null when the evidence disagrees with
 * itself. Null is the important case: a wrong key silently mis-pitches every
 * note of that letter for the whole staff, which is exactly the kind of quiet,
 * plausible-sounding error that made the previous version untrustworthy. Better
 * to leave it at the default and let someone set it in one tap.
 *
 * Two independent signals have to agree — what the glyphs look like, and where
 * they sit. Shape alone confuses a common-time C with a flat; position alone
 * cannot tell a natural from the accidental it cancels.
 */
export function readKeySignature(
  clean: Bitmap,
  staff: RawStaff,
  clef: ClefId,
): { sharps: number | null; endX: number } {
  const sp = staff.spacing;
  const glyphs = headGlyphs(clean, staff);

  // The key signature lives between the clef and the time signature. Both of
  // those are far bigger than an accidental, which is what marks the ends.
  // Height alone will not separate them: some houses draw a flat with a stem
  // rising clear above the staff, as tall as a bass clef. But only a flat is
  // tall *and* narrow at the top, because that height is all stem.
  const bulky = (g: Glyph) => {
    const w = g.x1 - g.x0 + 1;
    const h = g.y1 - g.y0 + 1;
    if (w > sp * 1.5 || h > sp * 4.6) return true;
    return h > sp * 3.1 && classify(clean, g) !== 'flat';
  };
  let from = 0;
  for (let i = 0; i < glyphs.length && glyphs[i].x0 - staff.left < sp * 6; i++) {
    if (bulky(glyphs[i])) from = i + 1;
  }
  const zone: Glyph[] = [];
  for (let i = from; i < glyphs.length; i++) {
    if (bulky(glyphs[i])) break;
    zone.push(glyphs[i]);
  }

  // A flat is a bowl with a stem, and at this size the two often come apart:
  // the bowl's tip stops a pixel short of the stem it hangs from. So a bare
  // vertical stroke is dropped, and what is left is one blob per accidental —
  // sometimes the whole flat, sometimes just its bowl, which is the part that
  // names the pitch either way.
  const marks = zone
    .filter((g) => {
      const w = g.x1 - g.x0 + 1;
      const h = g.y1 - g.y0 + 1;
      return w >= sp * 0.34 && w <= sp * 1.45 && h >= sp * 0.8 && h <= sp * 4.4;
    })
    .map((g) => ({
      g,
      kind: classify(clean, g),
      step: (staff.lines[4] - inkCentre(clean, g)) / (sp / 2),
    }));

  /**
   * Walk the marks against what a key signature of that many sharps or flats
   * looks like. The test is *where* they sit, not what they look like: the two
   * orders start in completely different places — F♯ on the top line of a
   * treble staff, B♭ on the middle line — and never coincide, whereas shape
   * alone confuses a lone bowl with a sharp and a common-time C with a flat.
   */
  const walk = (flat: boolean) => {
    const want = template(clef, flat);
    let n = 0;
    let prev: Glyph | null = null;
    let broken = false;
    for (const m of marks) {
      if (n >= 7) break;
      // A natural cancels the key before it; it is never part of the new one.
      if (m.kind === 'natural') continue;
      const adjacent = !prev || m.g.x0 - prev.x1 <= sp * 1.3;
      if (Math.abs(m.step - want[n]) <= 0.9 && adjacent) {
        n++;
        prev = m.g;
        continue;
      }
      if (!n) continue; // still in front of the signature, in the clef
      // The run ended. Something accidental-shaped butting up against it means
      // the reading is off by something, and a wrong key is worse than no key.
      if (adjacent) broken = true;
      break;
    }
    return { n, broken, endX: prev?.x1 ?? 0 };
  };

  // The two readings compete rather than veto each other. One accidental of a
  // four-flat signature can land within a whisker of where the first sharp
  // would go, and letting that near-miss disqualify the reading that explains
  // every mark would throw away the answer.
  const sharp = walk(false);
  const flat = walk(true);
  // Where the head of the staff ends and the music begins: the last accidental
  // of the signature, or failing that the clef. Note reading starts after it,
  // because everything printed here is the wrong shape to be a note and the
  // right size to be mistaken for one.
  const clefEnd = from > 0 ? glyphs[from - 1].x1 : staff.left + sp * 3.2;
  const endX = Math.max(clefEnd, sharp.endX, flat.endX);

  if (sharp.n !== flat.n) {
    const best = flat.n > sharp.n ? flat : sharp;
    const sharps = best.broken ? null : flat.n > sharp.n ? -flat.n : sharp.n;
    return { sharps, endX };
  }
  if (sharp.n) return { sharps: null, endX }; // equally good both ways, so neither is trusted

  // Nothing matched. Naturals with nothing after them are a key being cancelled,
  // which is positive evidence of C. Finding nothing at all is not evidence of
  // anything — it is just as likely that the signature was there and could not
  // be separated from whatever was printed beside it — so that answers null and
  // the key is inherited instead.
  const cancelled = marks.length > 0 && marks.every((m) => m.kind === 'natural');
  return { sharps: cancelled ? 0 : null, endX: cancelled ? marks[marks.length - 1].g.x1 : endX };
}

// --- accidentals beside a note ---------------------------------------------

/**
 * The accidental printed on a notehead, if there is one.
 *
 * Without this a note carrying a sharp sounds a semitone flat, and nothing on
 * screen says so — the app and the page disagree and only the page is right.
 * That is the quietest kind of wrong, so it is worth reading even though it is
 * the one glyph that has to be found in open music rather than at a staff head.
 *
 * What makes it tractable is that an accidental *hugs* its notehead. Everything
 * else that could be mistaken for one — a rest, the previous note and its stem
 * — either sits further away, or is the wrong size, or is a notehead already
 * known about. Where the evidence is not clean the answer is null and the key
 * signature applies, which is what the page would have meant anyway.
 */
export function readAccidental(
  clean: Bitmap,
  staff: RawStaff,
  head: { x: number; y: number },
  heads: Array<{ x: number; y: number }>,
): Alter {
  const sp = staff.spacing;
  const xTo = Math.round(head.x - sp * 0.75);
  const xFrom = Math.round(head.x - sp * 3.1);
  const yFrom = Math.max(0, Math.round(head.y - sp * 2.1));
  const yTo = Math.min(clean.h - 1, Math.round(head.y + sp * 2.1));
  if (xFrom < 0 || xTo - xFrom < 2) return null;

  // Columns of ink, split wherever there is a blank one. An accidental is a
  // single connected glyph, so nothing needs bridging.
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let x = xFrom; x <= xTo; x++) {
    let inked = false;
    for (let y = yFrom; y <= yTo && !inked; y++) inked = clean.data[y * clean.w + x] === 1;
    if (inked) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      spans.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0) spans.push([start, xTo]);

  // Nearest first: the accidental is the last thing before the notehead.
  for (const [x0, x1] of spans.reverse()) {
    // Too far to the left to belong to this note. A rest or the previous note
    // leaves a beat's worth of space; an accidental leaves a whisker.
    if (x1 < head.x - sp * 2.3) break;
    const w = x1 - x0 + 1;
    // The narrowest accidental here is a natural at 0.63 of a staff space, and
    // the thing this keeps out is a stem: a bare vertical stroke is full width
    // on every row of itself, which is exactly what a sharp looks like.
    if (w < sp * 0.45 || w > sp * 1.4) continue;

    // Only the band of rows through the notehead's own height — a stem or a
    // beam passing overhead is a different thing sharing the same columns.
    let y0 = -1;
    let y1 = -1;
    for (let y = Math.round(head.y); y >= yFrom; y--) {
      let inked = false;
      for (let x = x0; x <= x1 && !inked; x++) inked = clean.data[y * clean.w + x] === 1;
      if (!inked) break;
      y0 = y;
    }
    for (let y = Math.round(head.y); y <= yTo; y++) {
      let inked = false;
      for (let x = x0; x <= x1 && !inked; x++) inked = clean.data[y * clean.w + x] === 1;
      if (!inked) break;
      y1 = y;
    }
    if (y0 < 0 || y1 < 0) continue;
    const h = y1 - y0 + 1;
    // Engraving fixes these proportions: every accidental is between about two
    // and three staff spaces tall and much taller than it is wide. A beam, a
    // notehead and a time signature all fail that on shape alone, which is a
    // cheaper and steadier test than trying to recognise each of them.
    if (h < sp * 1.9 || h > sp * 3.5 || h < w * 1.8) continue;

    const g: Glyph = { x0, x1, y0, y1 };
    // A notehead sitting in the box is a notehead, whatever it looks like.
    if (heads.some((n) => n.x >= x0 - sp * 0.5 && n.x <= x1 + sp * 0.5 && n.y >= y0 && n.y <= y1))
      continue;
    // An accidental names the note it stands beside, so it is centred on it.
    if (Math.abs(inkCentre(clean, g) - head.y) > sp * 0.8) continue;

    let filled = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) filled += clean.data[y * clean.w + x];
    const density = filled / (w * h);
    if (density < 0.14 || density > 0.72) continue;

    return accidentalShape(clean, g);
  }
  return null;
}

/** Default clef by where a staff sits in its system. */
export function guessClef(positionInSystem: number, systemSize: number): ClefId {
  if (systemSize <= 1) return 'treble';
  return positionInSystem === systemSize - 1 ? 'bass' : 'treble';
}

export interface PageReading {
  staves: DetectedStaff[];
  notes: DetectedNote[];
}

/** Read one rendered page. */
export function readPage(image: ImageData, pageIndex: number): PageReading {
  const bm = toBitmap(image);
  const raw = findStaves(bm);
  if (!raw.length) return { staves: [], notes: [] };

  const clean = removeStaffLines(bm, raw);
  const systems = groupSystems(clean, raw);

  const staves: DetectedStaff[] = [];
  const notes: DetectedNote[] = [];

  systems.forEach((system, systemIndex) => {
    system.forEach((staffIndex, positionInSystem) => {
      const s = raw[staffIndex];
      const id = `p${pageIndex}s${staffIndex}`;
      const clef = guessClef(positionInSystem, system.length);
      const key = readKeySignature(clean, s, clef);
      staves.push({
        id,
        page: pageIndex,
        index: staffIndex,
        system: systemIndex,
        positionInSystem,
        lines: s.lines,
        spacing: s.spacing,
        top: s.top,
        bottom: s.bottom,
        left: s.left,
        right: s.right,
        clef,
        sharps: key.sharps,
      });

      const heads = findHeads(clean, s, key.endX + s.spacing * 0.6);
      heads.forEach((h, i) => {
        notes.push({
          id: `${id}n${i}`,
          page: pageIndex,
          staff: id,
          x: h.x,
          y: h.y,
          step: h.step,
          filled: h.filled,
          accidental: readAccidental(clean, s, h, heads),
        });
      });
    });
  });

  return { staves, notes };
}
