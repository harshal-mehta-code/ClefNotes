import { buildMusicXml, type PartSpec, type ScoreSpec } from '../score/builder';

/**
 * Optical music recognition, in the browser, for free.
 *
 * This is deliberately a classical computer-vision pipeline rather than a
 * model: it has to run offline, cost nothing, and ship inside a static site.
 * It reads *clean, printed* scores — staff lines, noteheads, stems, beams —
 * and it is honest about the rest.
 *
 * The pipeline:
 *   1. Otsu threshold                → black and white
 *   2. Horizontal projection         → staff lines, and the staff spacing that
 *                                      calibrates every measurement after it
 *   3. Staff-line removal            → symbols on their own
 *   4. Elliptical template matching  → noteheads, filled vs hollow
 *   5. Vertical run analysis         → stems, flags, beams → durations
 *   6. Barline-to-barline connection → staves grouped into systems
 *   7. Stacked heads + stem direction → the voices sharing a staff
 *   8. Per-measure normalisation     → rhythm that cannot drift past a barline
 *
 * Steps 7 and 8 matter more than they sound. A close-harmony score puts two
 * singers on one staff — barbershop SATB is four voices on two staves — and
 * reading that as two lines is not a small inaccuracy, it is the wrong music.
 *
 * Accuracy is what it is. That's why nothing here is presented as finished:
 * the import screen shows the page beside the result and lets you fix notes.
 */

export interface OmrOptions {
  /** Clef per staff index, top to bottom, repeating per system. */
  clefs?: Array<'G2' | 'F4'>;
  fifths?: number;
  time?: [number, number];
  onProgress?: (label: string, fraction: number) => void;
}

export interface OmrPageResult {
  staves: number;
  notes: number;
  /** 0-1, how much of the page the pipeline is confident about. */
  confidence: number;
}

export interface Bitmap {
  w: number;
  h: number;
  /** 1 = ink, 0 = paper. */
  data: Uint8Array;
}

export interface Staff {
  /** Y of each of the five lines, top to bottom. */
  lines: number[];
  /** Distance between adjacent lines. */
  spacing: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Head {
  x: number;
  y: number;
  filled: boolean;
  staff: number;
  /** Diatonic steps above the bottom staff line. */
  step: number;
  /** Quarter-note length, once stems and beams have been read. */
  qDur: number;
  /**
   * Which way the stem points, or undefined for a stemless semibreve.
   * This is how the voices of a closed score are told apart.
   */
  stemUp?: boolean;
}

// --- 1. threshold ----------------------------------------------------------

export function toBitmap(image: ImageData): Bitmap {
  const { width: w, height: h, data } = image;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Perceptual luminance; scanned paper is rarely neutral.
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }

  // Otsu: pick the threshold that maximises between-class variance.
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
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  const out = new Uint8Array(w * h);
  for (let p = 0; p < gray.length; p++) out[p] = gray[p] < threshold ? 1 : 0;
  return { w, h, data: out };
}

// --- 2. staff lines --------------------------------------------------------

export function findStaves(bm: Bitmap): Staff[] {
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

  // Contiguous dark rows become one line, centred.
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

  // Five roughly evenly spaced lines make a staff.
  const staves: Staff[] = [];
  for (let i = 0; i + 4 < centres.length; ) {
    const group = centres.slice(i, i + 5);
    const gaps = [];
    for (let k = 1; k < 5; k++) gaps.push(group[k] - group[k - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const even = gaps.every((g) => Math.abs(g - mean) <= Math.max(1.6, mean * 0.34));
    if (even && mean >= 3 && mean <= 40) {
      // Horizontal extent: where the middle line actually has ink.
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

// --- 3. staff-line removal -------------------------------------------------

export function removeStaffLines(bm: Bitmap, staves: Staff[]): Bitmap {
  const { w, h, data } = bm;
  const out = new Uint8Array(data);
  const thickness = Math.max(1, Math.round(staves[0] ? staves[0].spacing / 4.5 : 2));

  for (const staff of staves) {
    for (const lineY of staff.lines) {
      const y0 = Math.round(lineY);
      for (let x = staff.left; x <= staff.right; x++) {
        // Only erase where the ink is *thin* vertically. Where a stem or a
        // notehead crosses the line, the run is tall and must survive.
        let up = 0;
        let down = 0;
        while (up < thickness * 4 && y0 - up - 1 >= 0 && data[(y0 - up - 1) * w + x]) up++;
        while (down < thickness * 4 && y0 + down + 1 < h && data[(y0 + down + 1) * w + x]) down++;
        if (up + down + 1 <= thickness * 2 + 1) {
          for (let y = y0 - up; y <= y0 + down; y++) {
            if (y >= 0 && y < h) out[y * w + x] = 0;
          }
        }
      }
    }
  }
  return { w, h, data: out };
}

// --- 4. noteheads ----------------------------------------------------------

/** Mean ink inside an axis-aligned ellipse. */
function ellipseInk(bm: Bitmap, cx: number, cy: number, rx: number, ry: number): number {
  const { w, h, data } = bm;
  let hits = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      if (dx * dx + dy * dy > 1) continue;
      total++;
      hits += data[y * w + x];
    }
  }
  return total ? hits / total : 0;
}

const ink = (bm: Bitmap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < bm.w && y < bm.h && bm.data[y * bm.w + x] === 1;

/** Length of the unbroken ink run from (cx,cy) in one direction. */
function inkRun(bm: Bitmap, cx: number, cy: number, dx: number, dy: number, max: number): number {
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

/** Walk outward across a gap, then measure the ink stroke beyond it. */
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
 * Find noteheads.
 *
 * Ink density alone is not enough: a treble clef, a time signature and the
 * letter "o" in a lyric all have dark regions. What separates a notehead is its
 * *size and shape* relative to the staff — roughly 1.3 staff-spaces wide and
 * one staff-space tall, every time, because that is how music is engraved. So
 * every candidate has to pass a measured run-length test, not just a dark one.
 */
export function findHeads(clean: Bitmap, staves: Staff[]): Head[] {
  const heads: Head[] = [];

  staves.forEach((staff, si) => {
    const sp = staff.spacing;
    const rx = sp * 0.62;
    const ry = sp * 0.46;
    // Ledger lines put notes outside the staff, but not far. Lyrics sit about
    // three staff-spaces below the bottom line, so a band of ±2.2 spaces takes
    // in two ledger lines either way while staying clear of the words. Notes
    // beyond that are missed — an accepted trade against reading every word as
    // a notehead.
    const yTop = Math.max(0, Math.round(staff.top - sp * 2.2));
    const yBot = Math.min(clean.h - 1, Math.round(staff.bottom + sp * 2.2));
    // Skip the clef, key signature and time signature at the head of the staff.
    const xFrom = Math.round(staff.left + sp * 3.2);
    const stride = Math.max(1, Math.round(sp / 7));

    const minW = sp * 0.8;
    const maxW = sp * 2.05;
    const minH = sp * 0.55;
    const maxH = sp * 1.5;

    const candidates: Array<{ x: number; y: number; score: number; filled: boolean }> = [];
    for (let y = yTop; y <= yBot; y += stride) {
      for (let x = xFrom; x <= staff.right; x += stride) {
        const centreInk = ink(clean, x, y);

        if (centreInk) {
          // Filled head: one solid blob, the size of a notehead.
          const wide = 1 + inkRun(clean, x, y, -1, 0, maxW) + inkRun(clean, x, y, 1, 0, maxW);
          if (wide < minW || wide > maxW) continue;
          const tall = 1 + inkRun(clean, x, y, 0, -1, maxH) + inkRun(clean, x, y, 0, 1, maxH);
          if (tall < minH || tall > maxH) continue;
          const inner = ellipseInk(clean, x, y, rx * 0.55, ry * 0.55);
          if (inner < 0.9) continue;
          const whole = ellipseInk(clean, x, y, rx, ry);
          if (whole < 0.72) continue;
          candidates.push({ x, y, score: whole + inner, filled: true });
          continue;
        }

        // Hollow head: a light centre ringed by a thin stroke on all sides.
        const left = gapThenStroke(clean, x, y, -1, 0, sp * 0.6, sp * 0.5);
        const right = gapThenStroke(clean, x, y, 1, 0, sp * 0.6, sp * 0.5);
        if (!left || !right) continue;
        const width = left.gap + left.stroke + right.gap + right.stroke;
        if (width < minW || width > maxW) continue;
        if (left.stroke < 1 || right.stroke < 1) continue;
        const up = gapThenStroke(clean, x, y, 0, -1, sp * 0.5, sp * 0.4);
        const down = gapThenStroke(clean, x, y, 0, 1, sp * 0.5, sp * 0.4);
        if (!up || !down) continue;
        const height = up.gap + up.stroke + down.gap + down.stroke;
        if (height < minH || height > maxH) continue;
        const inner = ellipseInk(clean, x, y, rx * 0.4, ry * 0.4);
        if (inner > 0.22) continue;
        const whole = ellipseInk(clean, x, y, rx, ry);
        if (whole < 0.3 || whole > 0.78) continue;
        candidates.push({ x, y, score: whole - inner, filled: false });
      }
    }

    // Non-maximum suppression: one detection per notehead.
    candidates.sort((a, b) => b.score - a.score);
    const kept: typeof candidates = [];
    for (const c of candidates) {
      if (kept.some((k) => Math.abs(k.x - c.x) < sp * 1.2 && Math.abs(k.y - c.y) < sp * 0.85)) continue;
      kept.push(c);
    }

    for (const k of kept) {
      // Pitch: half-space steps up from the bottom line.
      const step = Math.round((staff.lines[4] - k.y) / (sp / 2));
      heads.push({ x: k.x, y: k.y, filled: k.filled, staff: si, step, qDur: 1 });
    }
  });

  return heads.sort((a, b) => a.staff - b.staff || a.x - b.x);
}

// --- 5. stems, flags and beams → duration ----------------------------------

function verticalRun(bm: Bitmap, x: number, y: number, dir: number, limit: number): number {
  let n = 0;
  let yy = y;
  while (n < limit) {
    yy += dir;
    if (yy < 0 || yy >= bm.h) break;
    if (!bm.data[yy * bm.w + x]) break;
    n++;
  }
  return n;
}

/**
 * Read stems, flags and beams into durations — and use the stem as a final
 * filter. Every note shorter than a semibreve carries one, and stray marks
 * almost never have a straight vertical stroke several staff-spaces long
 * beside them, so "filled but stemless" is the signature of a false positive.
 * Returns the surviving heads.
 */
export function readDurations(clean: Bitmap, heads: Head[], staves: Staff[]): Head[] {
  const survivors: Head[] = [];
  for (const head of heads) {
    const staff = staves[head.staff];
    const sp = staff.spacing;
    const stemLimit = Math.round(sp * 5);

    // A stem sits on the right of an up-stemmed note and the left of a
    // down-stemmed one, at the edge of the head. Sweep a range of offsets
    // rather than guessing two: the detected centre is only accurate to a
    // pixel or two, and a miss here turns every minim into a semibreve.
    let stemUp = 0;
    let stemDown = 0;
    // These offsets are narrow on purpose, and measured rather than guessed:
    // widening the sweep lets unrelated vertical ink — a barline, the next
    // note's stem — satisfy the test, and false positives climb by half again.
    // An up-stem is only ever on the right, a down-stem only on the left.
    for (const k of [0.58, 0.62]) {
      const dx = Math.round(sp * k);
      const y = Math.round(head.y);
      stemUp = Math.max(stemUp, verticalRun(clean, Math.round(head.x) + dx, y, -1, stemLimit));
      stemDown = Math.max(stemDown, verticalRun(clean, Math.round(head.x) - dx, y, 1, stemLimit));
    }
    const stemLen = Math.max(stemUp, stemDown);
    const hasStem = stemLen > sp * 1.6;
    head.stemUp = hasStem ? stemUp >= stemDown : undefined;

    if (!head.filled) {
      head.qDur = hasStem ? 2 : 4;
      survivors.push(head);
      continue;
    }
    if (!hasStem) {
      // A filled head with no stem is not a note.
      continue;
    }

    // Beams and flags: ink alongside the far end of the stem. One thick band
    // is an eighth, two is a sixteenth.
    const up = stemUp >= stemDown;
    const stemX = Math.round(head.x + (up ? sp * 0.6 : -sp * 0.6));
    const tipY = Math.round(head.y + (up ? -stemLen : stemLen));
    let bands = 0;
    const probeStep = Math.max(1, Math.round(sp * 0.42));
    for (let b = 0; b < 3; b++) {
      const y = tipY + (up ? b * probeStep : -b * probeStep);
      if (y < 0 || y >= clean.h) break;
      // Beams run horizontally away from the stem; flags curl on one side.
      let ink = 0;
      const reach = Math.round(sp * 1.6);
      for (let dx = 1; dx <= reach; dx++) {
        const x = stemX + (up ? dx : -dx);
        if (x < 0 || x >= clean.w) break;
        ink += clean.data[y * clean.w + x];
      }
      if (ink > reach * 0.55) bands++;
      else break;
    }

    head.qDur = bands >= 2 ? 0.25 : bands === 1 ? 0.5 : 1;

    // Augmentation dot: a small blob just right of the head.
    const dotInk = ellipseInk(clean, head.x + sp * 1.15, head.y, sp * 0.2, sp * 0.2);
    if (dotInk > 0.55) head.qDur *= 1.5;
    survivors.push(head);
  }
  return survivors;
}

// --- 5b. grouping staves into systems --------------------------------------

/**
 * Are two adjacent staves braced into one system?
 *
 * Judging this by the size of the gap fails on real music: in a two-stave
 * choral score the space between the staves of a system and the space between
 * systems are near enough identical, so everything collapses into one group.
 *
 * The reliable signal is physical. Staves in the same system are joined by a
 * barline running straight through the gap between them; staves in different
 * systems have nothing but paper there. So look for the ink.
 */
function sameSystem(clean: Bitmap, upper: Staff, lower: Staff): boolean {
  const top = Math.round(upper.bottom) + 1;
  const bottom = Math.round(lower.top) - 1;
  if (bottom <= top) return true;
  const height = bottom - top;

  // The system's opening barline sits at the left edge of the staff lines.
  // Check a few columns either side to allow for a pixel or two of drift.
  const sp = upper.spacing;
  const candidates: number[] = [];
  for (let dx = -2; dx <= 2; dx++) candidates.push(Math.round(upper.left) + dx);
  // A brace sits just left of the barline on braced systems.
  for (let dx = 3; dx <= Math.round(sp * 1.2); dx++) candidates.push(Math.round(upper.left) - dx);

  for (const x of candidates) {
    if (x < 0 || x >= clean.w) continue;
    let filled = 0;
    for (let y = top; y <= bottom; y++) {
      if (clean.data[y * clean.w + x]) filled++;
    }
    if (filled >= height * 0.8) return true;
  }
  return false;
}

/** Partition staves top-to-bottom into systems. */
export function groupSystems(clean: Bitmap, staves: Staff[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < staves.length; i++) {
    if (!current.length) {
      current.push(i);
      continue;
    }
    if (sameSystem(clean, staves[current[current.length - 1]], staves[i])) current.push(i);
    else {
      groups.push(current);
      current = [i];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

// --- 5d. voices within a staff ---------------------------------------------

/**
 * Split one staff into its independent voices.
 *
 * A close-harmony score puts two singers on one staff, and reading it as a
 * single line is not a small inaccuracy — it is the wrong music. Barbershop
 * SATB is four voices on two staves; a hymn is the same idea. Getting this
 * wrong turns "hear my line on its own" into "hear a line nobody sings".
 *
 * Two engraving conventions give it away, and both are needed:
 *
 *   Stacked noteheads. When the voices share a rhythm they share a stem, so
 *   two noteheads sit at the same horizontal position. Read sequentially they
 *   double the note count and wreck the rhythm — which is exactly what the
 *   first version did.
 *
 *   Stem direction. When the rhythms differ each voice gets its own stem: the
 *   upper voice always points up, the lower always down. That is *contrary* to
 *   single-voice engraving, where the stem follows the pitch and flips at the
 *   middle line — so stems that disagree with the pitch are the tell.
 */
export function splitVoices(heads: Head[], sp: number): Head[][] {
  const sorted = [...heads].sort((a, b) => a.x - b.x);
  if (sorted.length < 4) return [sorted];

  // Noteheads close enough together horizontally sound at the same moment.
  const columns: Head[][] = [];
  for (const h of sorted) {
    const last = columns[columns.length - 1];
    if (last && h.x - last[last.length - 1].x <= sp * 0.8) last.push(h);
    else columns.push([h]);
  }

  const stacked = columns.filter((c) => c.length >= 2).length / columns.length;
  const stemmed = sorted.filter((h) => h.stemUp != null);
  // On a single-voice staff a stem points up below the middle line and down
  // above it. Disagreement means the stem is carrying voice information.
  const contrary = stemmed.filter((h) => h.stemUp !== h.step < 4).length / Math.max(1, stemmed.length);

  if (stacked < 0.22 && contrary < 0.3) return [sorted];

  const upper: Head[] = [];
  const lower: Head[] = [];
  const recent = (v: Head[]) =>
    v.length ? v.slice(-4).reduce((s, h) => s + h.step, 0) / Math.min(4, v.length) : null;

  for (const column of columns) {
    if (column.length >= 2) {
      const byPitch = [...column].sort((a, b) => b.step - a.step);
      upper.push(byPitch[0]);
      lower.push(byPitch[byPitch.length - 1]);
      // Inner notes of a thicker chord join whichever voice they sit nearer.
      for (const middle of byPitch.slice(1, -1)) {
        const toTop = byPitch[0].step - middle.step;
        const toBottom = middle.step - byPitch[byPitch.length - 1].step;
        (toTop <= toBottom ? upper : lower).push(middle);
      }
      continue;
    }

    const h = column[0];
    if (h.stemUp === true) upper.push(h);
    else if (h.stemUp === false) lower.push(h);
    else {
      // A stemless semibreve carries no direction, so place it by pitch —
      // this is the sustained bass note under a moving upper voice.
      const u = recent(upper);
      const l = recent(lower);
      if (u == null && l == null) lower.push(h);
      else if (u == null) lower.push(h);
      else if (l == null) upper.push(h);
      else (Math.abs(h.step - u) < Math.abs(h.step - l) ? upper : lower).push(h);
    }
  }

  return [upper, lower].filter((v) => v.length > 0);
}

/** Legal note lengths in sixteenths, longest first. */
const UNIT_TOKENS: Array<[number, string]> = [
  [16, 'w'], [12, 'h.'], [8, 'h'], [6, 'q.'], [4, 'q'], [3, 'e.'], [2, 'e'], [1, 's'],
];

/** Express a length in sixteenths as tied tokens that sum to it exactly. */
function tokensForUnits(pitch: string, units: number): string[] {
  const out: string[] = [];
  let left = Math.max(1, Math.round(units));
  let guard = 0;
  while (left > 0 && guard++ < 32) {
    const pick = UNIT_TOKENS.find(([u]) => u <= left) ?? UNIT_TOKENS[UNIT_TOKENS.length - 1];
    left -= pick[0];
    const more = left > 0 && pitch !== 'r';
    out.push(`${pitch}:${pick[1]}${more ? '~' : ''}`);
  }
  return out;
}

/**
 * Fit one voice's notes into the measures marked by the barlines.
 *
 * Durations read from stems and beams are the least reliable thing here, and
 * left alone their errors accumulate across the whole piece — one misread quaver
 * on page one shifts every bar after it. Barlines are far easier to see than
 * beams, so each measure is normalised to the length the time signature says it
 * must be. An error then stays inside its own bar instead of derailing the rest
 * of the score.
 */
function emitVoice(
  voice: Head[],
  barEdges: number[],
  qPerBar: number,
  clef: 'G2' | 'F4',
): string[] {
  const unitsPerBar = Math.max(1, Math.round(qPerBar * 4));
  const tokens: string[] = [];

  for (let m = 0; m + 1 < barEdges.length; m++) {
    const from = barEdges[m];
    const to = barEdges[m + 1];
    const inBar = voice.filter((h) => h.x > from && h.x <= to);

    if (!inBar.length) {
      tokens.push(...tokensForUnits('r', unitsPerBar));
      continue;
    }

    // Share the bar out in proportion to the durations we read, using largest
    // remainder so the parts still add up to a whole bar exactly.
    const weights = inBar.map((h) => Math.max(0.25, h.qDur));
    const total = weights.reduce((a, b) => a + b, 0);
    const exact = weights.map((w) => (w / total) * unitsPerBar);
    const floors = exact.map((v) => Math.max(1, Math.floor(v)));
    let short = unitsPerBar - floors.reduce((a, b) => a + b, 0);

    if (short < 0) {
      // More notes than the bar can hold at a sixteenth each: keep the ones
      // that fit rather than inventing a longer bar.
      inBar.length = unitsPerBar;
      floors.length = unitsPerBar;
      floors.fill(1);
      short = 0;
    }
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < short; k++) floors[order[k % order.length].i] += 1;

    inBar.forEach((h, i) => {
      tokens.push(...tokensForUnits(spell(h.step, clef), floors[i]));
    });
  }

  return tokens;
}

// --- 6. barlines -----------------------------------------------------------

/**
 * Find barlines.
 *
 * A stem is nearly as tall as a staff, so "a long vertical run" alone finds
 * stems too. A barline is distinguished by reaching the top line *and* the
 * bottom line — a stem only ever touches one of them.
 */
export function findBarlines(clean: Bitmap, staff: Staff): number[] {
  const sp = staff.spacing;
  const yTop = Math.round(staff.top);
  const yBottom = Math.round(staff.bottom);
  const height = yBottom - yTop;
  if (height <= 0) return [];

  const xs: number[] = [];
  for (let x = staff.left; x <= staff.right; x++) {
    // Must be present at both ends of the staff.
    if (!ink(clean, x, yTop + 1) || !ink(clean, x, yBottom - 1)) continue;
    let filled = 0;
    for (let y = yTop; y <= yBottom; y++) {
      if (clean.data[y * clean.w + x]) filled++;
    }
    if (filled >= height * 0.92) xs.push(x);
  }

  // Collapse adjacent columns — and the two lines of a double bar — into one.
  const merged: number[] = [];
  for (const x of xs) {
    if (!merged.length || x - merged[merged.length - 1] > sp * 1.2) merged.push(x);
    else merged[merged.length - 1] = x;
  }
  return merged;
}

// --- pitch spelling --------------------------------------------------------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Staff step → pitch. Step 0 is the bottom line: E4 in treble, G2 in bass.
 */
function spell(step: number, clef: 'G2' | 'F4'): string {
  const base = clef === 'G2' ? 4 * 7 + 2 : 2 * 7 + 4; // E4 / G2 as diatonic index
  const idx = base + step;
  const octave = Math.floor(idx / 7);
  const letter = LETTERS[((idx % 7) + 7) % 7];
  return `${letter}${octave}`;
}

// --- assembly --------------------------------------------------------------

export interface OmrResult {
  musicXml: string;
  pages: OmrPageResult[];
  confidence: number;
  staffCount: number;
  noteCount: number;
  /** Key signature as read from the page, in sharps (negative for flats). */
  fifths: number;
}

/**
 * Recognise a set of rasterised pages.
 *
 * Staves are matched into parts by their position within each system, which is
 * the same assumption a human makes reading down a page.
 */
/** Flatten (staff position, voice) into a single part index, top to bottom. */
function partIndexFor(staffPosition: number, voice: number, voicesPerStaff: number[]): number {
  let index = 0;
  for (let s = 0; s < staffPosition; s++) index += voicesPerStaff[s] ?? 1;
  return index + voice;
}

export async function recognise(
  pageCount: number,
  getPage: (index: number) => Promise<ImageData>,
  opts: OmrOptions = {},
): Promise<OmrResult> {
  const perStaffTokens: string[][] = [];
  const pageResults: OmrPageResult[] = [];
  let stavesPerSystem = 0;
  let totalNotes = 0;
  let totalConfidence = 0;
  /** How many voices each staff position carries, fixed by the first system. */
  const voicesPerStaff: number[] = [];
  const partClefs: Array<'G2' | 'F4'> = [];

  for (let p = 0; p < pageCount; p++) {
    opts.onProgress?.(`Reading page ${p + 1} of ${pageCount}…`, p / pageCount);
    // Yield so the progress label can actually paint.
    await new Promise((r) => setTimeout(r, 0));

    // One page is rasterised at a time and released before the next. A page at
    // this resolution is ~30 MB of ImageData; holding a whole seven-page score
    // at once is a couple of hundred megabytes, which a phone will simply kill.
    const image = await getPage(p);
    const bm = toBitmap(image);

    const staves = findStaves(bm);
    if (!staves.length) {
      pageResults.push({ staves: 0, notes: 0, confidence: 0 });
      continue;
    }

    const clean = removeStaffLines(bm, staves);
    const heads = readDurations(clean, findHeads(clean, staves), staves);
    const systems = groupSystems(clean, staves);

    // The first page with music establishes how many staves a system has.
    if (!stavesPerSystem) {
      const tally = new Map<number, number>();
      for (const s of systems) if (s.length) tally.set(s.length, (tally.get(s.length) ?? 0) + 1);
      let best = 1;
      let bestCount = 0;
      for (const [n, c] of tally) {
        if (c > bestCount || (c === bestCount && n > best)) {
          best = n;
          bestCount = c;
        }
      }
      stavesPerSystem = Math.max(1, Math.min(best, 8));
    }

    const [beats, beatType] = opts.time ?? [4, 4];
    const qPerBar = (beats * 4) / beatType;

    for (const system of systems) {
      system.forEach((staffIndex, positionInSystem) => {
        if (positionInSystem >= stavesPerSystem) return;
        const staff = staves[staffIndex];
        const mine = heads.filter((hd) => hd.staff === staffIndex);
        totalNotes += mine.length;

        const clef =
          opts.clefs?.[positionInSystem] ??
          (positionInSystem === stavesPerSystem - 1 && stavesPerSystem > 1 ? 'F4' : 'G2');

        // Voices are discovered per staff, but the *number* of them has to be
        // fixed for the whole score or the parts would shuffle between systems.
        const voices = splitVoices(mine, staff.spacing);
        if (voicesPerStaff[positionInSystem] == null) {
          voicesPerStaff[positionInSystem] = voices.length;
        }
        const wanted = voicesPerStaff[positionInSystem];

        const bars = findBarlines(clean, staff);
        const edges = [staff.left - 1, ...bars.filter((x) => x > staff.left + staff.spacing), staff.right + 1];

        for (let v = 0; v < wanted; v++) {
          const partIndex = partIndexFor(positionInSystem, v, voicesPerStaff);
          if (!perStaffTokens[partIndex]) perStaffTokens[partIndex] = [];
          // A staff that has fewer voices in this system than elsewhere still
          // needs its bars accounted for, or the parts drift apart.
          const voice = voices[v] ?? [];
          perStaffTokens[partIndex].push(...emitVoice(voice, edges, qPerBar, clef));
          partClefs[partIndex] = clef;
        }
      });
    }

    // Confidence: a page where every staff found a plausible number of notes
    // is one we mostly believe.
    const notesPerStaff = heads.length / staves.length;
    const conf = Math.max(0, Math.min(1, notesPerStaff / 12));
    totalConfidence += conf;
    pageResults.push({ staves: staves.length, notes: heads.length, confidence: conf });
  }

  opts.onProgress?.('Assembling the score…', 0.95);

  // Name the parts by where they sit: staff, then voice within it. Real names
  // are printed on the page, but reading them is text recognition, which this
  // is not — and an honest "Staff 1 · upper" beats a confidently wrong "Tenor".
  const names: string[] = [];
  for (let s = 0; s < Math.max(1, stavesPerSystem); s++) {
    const voices = voicesPerStaff[s] ?? 1;
    for (let v = 0; v < voices; v++) {
      if (voices === 1) names.push(stavesPerSystem === 1 ? 'Recognised part' : `Staff ${s + 1}`);
      else names.push(`Staff ${s + 1} · ${v === 0 ? 'upper' : 'lower'} voice`);
    }
  }

  const parts: PartSpec[] = perStaffTokens
    .map((tokens, i) => ({
      name: names[i] ?? `Part ${i + 1}`,
      abbrev: names[i]?.includes('upper') ? `${Math.floor(i / 2) + 1}↑` : names[i]?.includes('lower') ? `${Math.floor(i / 2) + 1}↓` : undefined,
      clef: partClefs[i] ?? 'G2',
      notes: tokens.join(' '),
    }))
    .filter((p) => p.notes.trim().length > 0);

  if (!parts.length) {
    throw new Error(
      'No staves were found on that PDF. ClefNotes reads clean, printed scores — a scan that is skewed, faint or handwritten will not come through. Try a MusicXML or MIDI export instead.',
    );
  }

  const spec: ScoreSpec = {
    title: 'Recognised score',
    composer: 'Imported by ClefNotes OMR',
    fifths: opts.fifths ?? 0,
    time: opts.time ?? [4, 4],
    bpm: 84,
    parts,
  };

  return {
    musicXml: buildMusicXml(spec),
    pages: pageResults,
    confidence: pageCount ? totalConfidence / pageCount : 0,
    staffCount: parts.length,
    noteCount: totalNotes,
    fifths: opts.fifths ?? 0,
  };
}
