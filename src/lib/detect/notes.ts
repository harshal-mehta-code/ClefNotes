import type { ClefId, DetectedNote, DetectedStaff } from './types';

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
): Array<{ x: number; y: number; step: number; filled: boolean }> {
  const sp = staff.spacing;
  const rx = sp * 0.62;
  const ry = sp * 0.46;
  const yTop = Math.max(0, Math.round(staff.top - sp * 2.6));
  const yBot = Math.min(clean.h - 1, Math.round(staff.bottom + sp * 2.6));
  const xFrom = Math.round(staff.left + sp * 3.2); // past clef, key and time
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
    if (kept.some((k) => Math.abs(k.x - c.x) < sp * 1.15 && Math.abs(k.y - c.y) < sp * 0.85)) continue;
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
        clef: guessClef(positionInSystem, system.length),
      });

      findHeads(clean, s).forEach((h, i) => {
        notes.push({
          id: `${id}n${i}`,
          page: pageIndex,
          staff: id,
          x: h.x,
          y: h.y,
          step: h.step,
          filled: h.filled,
        });
      });
    });
  });

  return { staves, notes };
}
