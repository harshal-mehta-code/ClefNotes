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

/**
 * Ink or paper, decided against the local average rather than one number for
 * the whole page.
 *
 * A rendered PDF is lit perfectly by construction, and a single threshold is
 * exactly right for it. A photograph is not: one corner in shadow is darker
 * than the printed staff lines in the bright corner, so any global cut either
 * floods the shadow with ink or loses the music in the light. Comparing each
 * pixel with the average of the page around it removes the lighting and leaves
 * the printing, which is the only part that varies over a few pixels.
 */
function localBitmap(image: ImageData): Bitmap {
  const { width: w, height: h, data } = image;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  // Summed-area table, so a window average costs four lookups whatever its size.
  const sum = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }

  // Wide enough to average over paper rather than over the notehead you are
  // standing on, which would make every thick stroke its own background.
  const r = Math.max(8, Math.round(Math.min(w, h) / 28));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const total =
        sum[(y1 + 1) * (w + 1) + x1 + 1] -
        sum[y0 * (w + 1) + x1 + 1] -
        sum[(y1 + 1) * (w + 1) + x0] +
        sum[y0 * (w + 1) + x0];
      // A tenth below the local average: paper is flat, so anything meaningfully
      // darker than its surroundings is something printed on it.
      out[y * w + x] = gray[y * w + x] * area * 100 < total * 88 ? 1 : 0;
    }
  }
  return { w, h, data: out };
}

export function toBitmap(image: ImageData, local = false): Bitmap {
  if (local) return localBitmap(image);
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
      // Where the staff itself begins and ends: the longest unbroken run of ink
      // along its middle line. Taking the leftmost ink on that row instead picks
      // up whatever is printed beside the staff — a part name like "Melody" sits
      // exactly there — and then everything measured from the left edge starts
      // in the wrong place, including the point where reading notes begins,
      // which is how a treble clef came to be read as a notehead.
      const midY = Math.round(group[2]);
      const bridge = Math.max(2, Math.round(mean * 0.5));
      let left = -1;
      let right = -1;
      let runFrom = -1;
      let blank = 0;
      for (let x = 0; x < w; x++) {
        if (data[midY * w + x]) {
          if (runFrom < 0) runFrom = x;
          blank = 0;
        } else if (runFrom >= 0 && ++blank > bridge) {
          const end = x - blank;
          if (end - runFrom > right - left) {
            left = runFrom;
            right = end;
          }
          runFrom = -1;
        }
      }
      if (runFrom >= 0 && w - 1 - runFrom > right - left) {
        left = runFrom;
        right = w - 1;
      }
      if (left < 0) {
        i += 1;
        continue;
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

/**
 * Erase the staff lines, leaving what was printed on them.
 *
 * The rule is that ink standing tall at a line belongs to something else and
 * has to survive. How tall counts as tall is the whole problem, and guessing it
 * from the staff spacing was wrong in a way that was invisible for a long time:
 * at a generous threshold a *hollow* notehead is erased along with the line,
 * because the rim of one is only a few pixels of ink where a filled head is a
 * whole staff space of it. Half notes came out of this shredded into arcs —
 * detectable as nothing at all — while every quarter note came through intact.
 *
 * So each line measures itself. Across most of its length a staff line has
 * nothing on it but itself, which makes the median run height along it exactly
 * the line's own thickness, whatever the resolution or the engraving. Anything
 * thicker than that stays.
 */
export function removeStaffLines(bm: Bitmap, staves: RawStaff[]): Bitmap {
  const { w, h, data } = bm;
  const out = new Uint8Array(data);

  for (const staff of staves) {
    const reach = Math.max(4, Math.round(staff.spacing));
    for (const lineY of staff.lines) {
      const y0 = Math.round(lineY);
      if (y0 < 0 || y0 >= h) continue;

      const spans: Array<[number, number]> = [];
      const heights: number[] = [];
      for (let x = staff.left; x <= staff.right; x++) {
        if (!data[y0 * w + x]) {
          spans.push([0, -1]);
          continue;
        }
        let up = 0;
        let down = 0;
        while (up < reach && y0 - up - 1 >= 0 && data[(y0 - up - 1) * w + x]) up++;
        while (down < reach && y0 + down + 1 < h && data[(y0 + down + 1) * w + x]) down++;
        spans.push([up, down]);
        heights.push(up + down + 1);
      }
      if (!heights.length) continue;

      heights.sort((a, b) => a - b);
      const thickness = heights[heights.length >> 1];
      // One pixel of slack for where the line thickens against something drawn
      // on top of it. More than that starts eating noteheads again.
      const limit = thickness + 1;

      for (let x = staff.left; x <= staff.right; x++) {
        const [up, down] = spans[x - staff.left];
        if (down < 0 || up + down + 1 > limit) continue;
        for (let y = y0 - up; y <= y0 + down; y++) if (y >= 0 && y < h) out[y * w + x] = 0;
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

/**
 * Ink fraction in an elliptical annulus, with the radii given as fractions of
 * (rx, ry). This is how a hollow notehead is recognised: as a ring of ink with
 * paper inside it, measured over an area. Four rays out from the middle would
 * be cheaper, and that is what this used to do — but a ray meets the outline at
 * one pixel, so a single-pixel break in it makes the whole head vanish, and at
 * this size most heads have one somewhere.
 */
function annulusInk(
  bm: Bitmap,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): number {
  let hits = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(cx - rx * to));
  const x1 = Math.min(bm.w - 1, Math.ceil(cx + rx * to));
  const y0 = Math.max(0, Math.floor(cy - ry * to));
  const y1 = Math.min(bm.h - 1, Math.ceil(cy + ry * to));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const r2 = dx * dx + dy * dy;
      if (r2 < from * from || r2 > to * to) continue;
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

/**
 * The longest run of unbroken ink from a point, in any direction but upright.
 *
 * This is what a beam has and a notehead has not. A notehead is a blob about a
 * space and a half across whichever way you leave it — except straight up or
 * down, where its stem runs off, which is why that cone is left out. A beam is
 * a bar several spaces long, so leaving along it never stops. At the end of a
 * beamed group the corner is otherwise the size, shape and darkness of a
 * notehead, and this is the one measurement that still tells them apart.
 */
function longestRun(bm: Bitmap, cx: number, cy: number, max: number): number {
  let best = 0;
  for (let deg = -78; deg <= 78; deg += 6) {
    const a = (deg * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (const sign of [1, -1]) {
      let d = 0;
      while (d < max && ink(bm, Math.round(cx + ux * d * sign), Math.round(cy + uy * d * sign)))
        d++;
      if (d > best) best = d;
    }
  }
  return best;
}

/**
 * Fill in the holes that are small enough to be the inside of a notehead.
 *
 * This is the step that makes reading noteheads one problem instead of two.
 * Before it, a filled head and a hollow head were looked for separately, by
 * different tests — solid ink here, a ring of ink there — and the hollow test
 * was the fragile one, because a rim is three or four pixels of ink that any
 * threshold can break, and every gate it had to pass was another way to lose a
 * half note. Whole half notes went unread on that account.
 *
 * But the two are the *same shape*. Only the middle differs, and the middle is
 * a hole with a definite size: the inside of a notehead is smaller than the
 * notehead. So enclosed paper of about that size is painted in, after which a
 * half note is exactly as solid as a quarter note and one test finds both.
 * Whether it was hollow is read afterwards, from the original ink — a property
 * of a note that has already been found, rather than a hurdle in front of
 * finding it.
 *
 * Holes too big to be a notehead's — the space inside a beamed group, the bowl
 * of a clef — are left alone, which is what keeps them from becoming notes.
 */
export function fillHoles(bm: Bitmap, spacing: number): Bitmap {
  const { w, h, data } = bm;
  const out = new Uint8Array(data);

  // Paper reachable from the edge of the page is the background; everything
  // else is enclosed by ink. One flood from the border finds all of it.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, x + (h - 1) * w);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || data[p]) continue;
    seen[p] = 1;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // A notehead's hole, generously bounded. The inside of one runs about a
  // staff space across and half of one down; twice that in area leaves room for
  // a rim broken open into the neighbouring hole without letting in the gap
  // inside a beamed group, which is several spaces of paper.
  //
  // Deliberately not fussy about shape. A sharp has four cells of about this
  // size between its bars, and filling them makes the glyph one solid mark that
  // reads as a note — but the answer to that is not to guess which holes belong
  // to noteheads from the holes alone. A semibreve's counter is nearly round
  // and so is a sharp's cell; measured over these scores no proportion parts
  // them without taking whole notes with it. What tells them apart is whether
  // the mark they are inside of looks like the noteheads this page prints —
  // see `learnHeadTemplate`.
  const maxArea = spacing * spacing * 0.9;
  const maxW = spacing * 1.5;
  const maxH = spacing * 1.2;

  for (let p = 0; p < data.length; p++) {
    if (data[p] || seen[p]) continue;
    // An enclosed hole. Walk it, and paint it in if it is notehead-sized.
    const region: number[] = [];
    stack.push(p);
    seen[p] = 1;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    while (stack.length) {
      const q = stack.pop()!;
      region.push(q);
      const x = q % w;
      const y = (q - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !data[q - 1] && !seen[q - 1]) (seen[q - 1] = 1), stack.push(q - 1);
      if (x < w - 1 && !data[q + 1] && !seen[q + 1]) (seen[q + 1] = 1), stack.push(q + 1);
      if (y > 0 && !data[q - w] && !seen[q - w]) (seen[q - w] = 1), stack.push(q - w);
      if (y < h - 1 && !data[q + w] && !seen[q + w]) (seen[q + w] = 1), stack.push(q + w);
    }
    if (region.length > maxArea || x1 - x0 + 1 > maxW || y1 - y0 + 1 > maxH) continue;
    for (const q of region) out[q] = 1;
  }

  return { w, h, data: out };
}

/**
 * How well the ink at a point looks like a notehead, from 0 to 1.
 *
 * A score, not a verdict. The detector this replaced asked a candidate eight
 * yes-or-no questions and dropped it on the first no, which meant one thin rim,
 * one ledger line touching, one neighbouring head a step away could delete a
 * note that was obvious to the eye — and the failures moved around from one
 * engraving to the next, because a different question failed each time.
 * Weighing the evidence instead lets strong agreement outvote one poor
 * measurement, which is the difference between a reader that copes with an
 * unfamiliar page and one that has to be retuned for it.
 *
 * The evidence is what engraving guarantees. A notehead is an ellipse about
 * 1.3 staff spaces across and one tall, solid (once its hole is filled), and it
 * is the only thing on the page of that size that is not part of something
 * longer — so the ink stops at its edge in most directions, even when a stem
 * leaves the top and a beam crosses the bottom.
 */
function headScore(solid: Bitmap, cx: number, cy: number, sp: number): number {
  const rx = sp * 0.62;
  const ry = sp * 0.46;

  // Solid through the middle. The single most telling measurement: whatever
  // else is around, the inside of a notehead is ink all the way across.
  const core = ellipseInk(solid, cx, cy, rx * 0.72, ry * 0.72);
  if (core < 0.75) return 0;
  const body = ellipseInk(solid, cx, cy, rx, ry);

  // And it stops. A beam, a stem, a barline, a bracket all carry on past where
  // a notehead's edge would be. Chords and seconds put a real head in the
  // collar too, so this is weighed rather than obeyed.
  const collar = annulusInk(solid, cx, cy, rx, ry, 1.5, 2.1);

  // The one thing no amount of agreement should outvote. A notehead is a blob:
  // leave it in any direction but straight up or down — where its own stem runs
  // off — and you are on paper within two staff spaces. A beam is a bar several
  // spaces long, and at the end of a beamed group its corner is otherwise the
  // size, shape and darkness of a note.
  if (longestRun(solid, cx, cy, sp * 3) >= sp * 3) return 0;

  return Math.max(0, core * 0.5 + body * 0.5 - Math.max(0, collar - 0.3) * 0.7);
}

/**
 * The horizontal bands of the page that are text rather than music.
 *
 * Choral music is the case this app exists for, and choral music has words
 * printed between every pair of staves. That is a problem no amount of looking
 * at one blob at a time can solve: an o, an e, an a, a 4, once their middles
 * are filled in, are ellipses about the size of a notehead, sitting the right
 * distance off the staff to be a note on a ledger line, and often with a tall
 * thin ascender beside them where a stem would be. Every test that reads one
 * mark on its own merits will be fooled by some of them, on some page, in some
 * typeface — which is exactly the sort of failure that moves around and never
 * quite gets fixed.
 *
 * What is not fooled is looking at them together. Text sits on a baseline: a
 * row of marks, of a common size, whose bottoms line up along the page, over
 * and over. Music has no baseline — noteheads are scattered up and down by
 * pitch, which is the entire point of them. So a run of small marks sharing a
 * bottom edge is a line of words, and everything in that band can be ignored,
 * whatever the individual marks look like.
 */
export function findTextBands(clean: Bitmap, staves: RawStaff[]): Array<[number, number]> {
  const { w, h, data } = clean;
  if (!staves.length) return [];
  const sp = staves.map((s) => s.spacing).sort((a, b) => a - b)[staves.length >> 1];

  // Only outside the staves. Inside one, aligned marks of a common size are
  // ordinary music — a run of noteheads along a line is exactly that.
  const inStaff = new Uint8Array(h);
  for (const s of staves) {
    const y0 = Math.max(0, Math.floor(s.top - sp * 0.6));
    const y1 = Math.min(h - 1, Math.ceil(s.bottom + sp * 0.6));
    for (let y = y0; y <= y1; y++) inStaff[y] = 1;
  }

  const seen = new Uint8Array(w * h);
  const marks: Array<{ x: number; y0: number; y1: number }> = [];
  const stack: number[] = [];
  for (let p = 0; p < data.length; p++) {
    // Nothing whose every pixel is inside a staff can be a word, so it is not
    // worth walking — which skips the beams, the stems and most of the ink on
    // the page. Anything reaching out of a staff is still walked, from the part
    // of it that does.
    if (!data[p] || seen[p] || inStaff[(p / w) | 0]) continue;
    seen[p] = 1;
    stack.push(p);
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    let size = 0;
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const x = q % w;
      const y = (q - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // Eight-connected: a letter printed at this size is held together by its
      // diagonals as much as by its sides.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (data[r] && !seen[r]) {
            seen[r] = 1;
            stack.push(r);
          }
        }
      }
    }
    // Letter-sized, clear of the staves, and not a hair or a speck.
    if (inStaff[y0] || inStaff[y1]) continue;
    if (size < sp * 1.5) continue;
    if (y1 - y0 + 1 > sp * 2.6 || x1 - x0 + 1 > sp * 2.6) continue;
    if (y1 - y0 + 1 < sp * 0.4 || x1 - x0 + 1 < sp * 0.2) continue;
    marks.push({ x: (x0 + x1) / 2, y0, y1 });
  }

  // Gather them by where they sit on their baseline. A descender hangs below
  // it, so the bottom of the commonest row is what lines up, not every bottom.
  const tolerance = Math.max(2, Math.round(sp * 0.35));
  marks.sort((a, b) => a.y1 - b.y1);
  const bands: Array<[number, number]> = [];
  for (let i = 0; i < marks.length; ) {
    let j = i;
    while (j + 1 < marks.length && marks[j + 1].y1 - marks[i].y1 <= tolerance) j++;
    const group = marks.slice(i, j + 1);
    i = j + 1;
    // A word or two at least, spread along the page rather than stacked in one
    // place — which is what tells a line of lyrics from a chord.
    if (group.length < 5) continue;
    const xs = group.map((m) => m.x);
    if (Math.max(...xs) - Math.min(...xs) < sp * 12) continue;
    bands.push([Math.min(...group.map((m) => m.y0)), Math.max(...group.map((m) => m.y1))]);
  }
  return bands;
}

/**
 * Whether something has a stem: a thin vertical stroke rising or falling from
 * one side of it, a couple of staff spaces long.
 *
 * Asked only of ink beyond the staff, and for one reason — that is where the
 * lyrics are. A word of text under a staff is a row of blobs about the size of
 * noteheads, and once the holes in them are filled an o, an e, an a and a 4 are
 * all past arguing with on their own merits. But a note off the staff is joined
 * to the music: it is hanging off a stem that reaches back towards the staff,
 * because that is how far it had to travel to get out there. Nothing printed in
 * a lyric is.
 */
function hasStem(clean: Bitmap, x: number, y: number, sp: number): boolean {
  const want = Math.round(sp * 1.6);
  for (const side of [-1, 1]) {
    // The stem meets the head at its side, a touch in from the widest point.
    for (let off = sp * 0.5; off <= sp * 0.72; off += 1) {
      const px = Math.round(x + side * off);
      for (const dir of [-1, 1]) {
        let n = 0;
        let miss = 0;
        for (let d = 1; d <= want * 1.6 && miss <= 1; d++) {
          if (ink(clean, px, y + dir * d)) {
            n++;
            miss = 0;
          } else miss++;
        }
        if (n >= want) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a note this far off the staff has the ledger line it would need.
 *
 * Off the staff, notation stops being able to say where a pitch is without
 * drawing the line to measure it from — so a note more than a space clear of
 * the staff always has a ledger line through it or immediately beside it. That
 * makes ledgers the test for whether something out there is a note at all,
 * which matters because the margins are where the page keeps everything that is
 * not music: measure numbers, lyrics, dynamics, rehearsal marks. Once their
 * middles are painted in, a 4 and a 0 and an o are notehead-sized blobs, and no
 * amount of looking at the blob itself will say otherwise. What says otherwise
 * is that nothing drew a line to hang them from.
 */
function hasLedger(clean: Bitmap, staff: RawStaff, x: number, step: number): boolean {
  const sp = staff.spacing;
  // The line it would sit on, or the nearer of the two it sits between.
  for (const line of step > 9 ? [step + (step % 2), step - (step % 2)] : [step - (step % 2), step + (step % 2)]) {
    const y = Math.round(staff.lines[4] - (line * sp) / 2);
    if (y < 0 || y >= clean.h) continue;
    // A ledger line is thin and reaches past the notehead on both sides. Both
    // halves of that matter: any ink at all out there is no test, because the
    // letters of a lyric stand shoulder to shoulder and each one has its
    // neighbours where a ledger would be. A stroke a couple of pixels deep,
    // running unbroken from one side of the head to the other, is a ledger and
    // nothing else printed near a staff looks like it.
    // Looked for out to the sides only: through the middle the head's own ink
    // is there instead, and it is not thin.
    const thin = Math.max(2, Math.round(sp * 0.4));
    const lineAt = (px: number) => {
      for (let dy = -1; dy <= 1; dy++) {
        if (!ink(clean, px, y + dy)) continue;
        let up = 0;
        while (up < thin + 2 && ink(clean, px, y + dy - up - 1)) up++;
        let down = 0;
        while (down < thin + 2 && ink(clean, px, y + dy + down + 1)) down++;
        if (up + down + 1 <= thin) return true;
      }
      return false;
    };
    // How far the ledger sticks out past the head is a matter of house style —
    // some engravings clear it by a third of a space, some barely at all — so
    // the wing is looked for anywhere in that range rather than all through it.
    const wing = (dir: number) => {
      for (let d = sp * 0.66; d <= sp * 1.0; d += 1) {
        if (lineAt(Math.round(x + dir * d))) return true;
      }
      return false;
    };
    if (wing(-1) && wing(1)) return true;
  }
  return false;
}

/**
 * What a notehead looks like *on this page*.
 *
 * Everything this reader knew about the shape of a notehead used to be a
 * number written down here: 1.3 staff spaces across, one tall, this much ink
 * inside, that much allowed outside, holes half again as wide as they are
 * tall. Each held for the scores it was written against and broke on the next
 * — a sharp is narrow, so narrow marks were banned, and a whole note in a
 * tight engraving was banned along with it. Numbers picked by looking at three
 * PDFs describe those three PDFs.
 *
 * The page knows better. A notehead is the most repeated mark on any engraved
 * score — hundreds of them, identical, stamped from one glyph — so the average
 * of the marks that look roughly like one *is* that page's notehead, at its
 * size, in its typeface, at whatever resolution and quality it arrived in.
 * Taking the median rather than the mean makes it proof against a minority of
 * wrong exemplars: a few sharps or beam corners among four hundred marks move
 * a median not at all.
 *
 * Everything found afterwards is measured against it — and against how well
 * the page's own noteheads match it, so that the bar is set by this engraving
 * too. A sharp is then turned away for the honest reason: it does not look
 * like the thing printed two hundred times on this page.
 */
export interface HeadTemplate {
  /** Half-width and half-height of the patch, in pixels. */
  rx: number;
  ry: number;
  /** Ink or not, per pixel, row-major over (2rx+1) × (2ry+1). */
  data: Float32Array;
  mean: number;
  norm: number;
  /** How many marks it was learned from. */
  exemplars: number;
  /**
   * How poor a match the page's own noteheads can be — taken from the worst of
   * them, so the bar is set by real notes rather than by a number I chose.
   */
  cut: number;
}

function templateFrom(
  data: Float32Array,
  rx: number,
  ry: number,
  exemplars: number,
  cut = 0.5,
): HeadTemplate {
  let mean = 0;
  for (const v of data) mean += v;
  mean /= data.length;
  let norm = 0;
  for (const v of data) norm += (v - mean) * (v - mean);
  return { rx, ry, data, mean, norm: Math.sqrt(norm) || 1, exemplars, cut };
}

/**
 * The fallback for a page with too few marks to learn from: an ellipse of the
 * proportions engraving has always used.
 */
function ellipseTemplate(sp: number): HeadTemplate {
  const rx = Math.max(2, Math.round(sp * 0.8));
  const ry = Math.max(2, Math.round(sp * 0.62));
  const w = rx * 2 + 1;
  const data = new Float32Array(w * (ry * 2 + 1));
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const u = x / (sp * 0.62);
      const v = y / (sp * 0.46);
      data[(y + ry) * w + x + rx] = u * u + v * v <= 1 ? 1 : 0;
    }
  }
  return templateFrom(data, rx, ry, 0, 0.45);
}

/** How well the ink around a point matches one template, from -1 to 1. */
function matchOne(bm: Bitmap, t: HeadTemplate, cx: number, cy: number): number {
  const n = t.data.length;
  let sum = 0;
  const patch = new Float32Array(n);
  for (let y = -t.ry, i = 0; y <= t.ry; y++) {
    for (let x = -t.rx; x <= t.rx; x++, i++) {
      const v = ink(bm, cx + x, cy + y) ? 1 : 0;
      patch[i] = v;
      sum += v;
    }
  }
  const mean = sum / n;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const d = patch[i] - mean;
    cross += d * (t.data[i] - t.mean);
    norm += d * d;
  }
  norm = Math.sqrt(norm);
  return norm < 1e-6 ? 0 : cross / (norm * t.norm);
}

/** Whether a mark clears the bar for any of the shapes the page prints. */
function matches(bm: Bitmap, ts: HeadTemplate[], cx: number, cy: number): boolean {
  return ts.some((t) => matchOne(bm, t, cx, cy) >= t.cut);
}

/**
 * Learn this page's notehead from this page.
 *
 * Candidates are gathered with the loosest idea of one — ink of roughly the
 * right size — then settled onto the middle of whatever they landed on, and
 * averaged pixel by pixel. Stems, dots and ledger lines are in some exemplars
 * and not others, and on different sides, so they fall out of the middle of
 * the distribution; the head, which is in all of them and always in the same
 * place, is what is left.
 */
export function learnHeadTemplate(solid: Bitmap, staves: RawStaff[]): HeadTemplate[] {
  if (!staves.length) return [ellipseTemplate(8)];
  const sp = staves.map((s) => s.spacing).sort((a, b) => a - b)[staves.length >> 1];
  const fallback = ellipseTemplate(sp);
  const rx = fallback.rx;
  const ry = fallback.ry;
  const stride = Math.max(1, Math.round(sp / 5));

  const picks: Array<{ x: number; y: number; score: number }> = [];
  for (const staff of staves) {
    const yTop = Math.max(0, Math.round(staff.top - sp));
    const yBot = Math.min(solid.h - 1, Math.round(staff.bottom + sp));
    const xFrom = Math.round(staff.left + sp * 5);
    for (let y = yTop; y <= yBot; y += stride) {
      for (let x = xFrom; x <= staff.right; x += stride) {
        if (!ink(solid, x, y)) continue;
        const wide = 1 + run(solid, x, y, -1, 0, sp * 2.4) + run(solid, x, y, 1, 0, sp * 2.4);
        if (wide < sp * 0.9 || wide > sp * 2.3) continue;
        const tall = 1 + run(solid, x, y, 0, -1, sp * 2) + run(solid, x, y, 0, 1, sp * 2);
        if (tall < sp * 0.7 || tall > sp * 1.5) continue;
        if (longestRun(solid, x, y, sp * 3) >= sp * 3) continue;
        const score = headScore(solid, x, y, sp);
        if (score > 0.6) picks.push({ x, y, score });
      }
    }
  }

  // Settle each one onto the middle of the mark it landed on. They start as
  // points on a grid that happened to find ink, which is anywhere within half a
  // head of the centre, and averaging patches cut around points like that
  // averages the smear rather than the shape.
  for (const p of picks) {
    for (let step = Math.max(1, Math.round(sp / 4)); step >= 1; step >>= 1) {
      for (let moved = true; moved; ) {
        moved = false;
        for (const [dx, dy] of [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ]) {
          const better = headScore(solid, p.x + dx, p.y + dy, sp);
          if (better > p.score + 1e-6) {
            p.x += dx;
            p.y += dy;
            p.score = better;
            moved = true;
          }
        }
      }
    }
  }

  // One exemplar per mark, so a head sampled six times does not count six times.
  picks.sort((a, b) => b.score - a.score);
  const used: typeof picks = [];
  for (const p of picks) {
    if (used.some((u) => Math.abs(u.x - p.x) < sp * 0.8 && Math.abs(u.y - p.y) < sp * 0.5)) continue;
    used.push(p);
    if (used.length >= 400) break;
  }
  // Too few to learn from — a page of mostly rests, or a fragment. The ellipse
  // is a poorer template but an honest one, and it does not depend on the page.
  if (used.length < 24) return [fallback];

  const w = rx * 2 + 1;
  const h = ry * 2 + 1;
  const data = new Float32Array(w * h);
  for (let y = -ry, i = 0; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++, i++) {
      let inked = 0;
      for (const u of used) inked += ink(solid, u.x + x, u.y + y) ? 1 : 0;
      // The median of a sample of noughts and ones is whether most had ink.
      data[i] = inked * 2 > used.length ? 1 : 0;
    }
  }
  const learned = templateFrom(data, rx, ry, used.length);

  /**
   * Music has more than one notehead, and the difference between them is
   * width. The black head and the white head share an outline — once the hole
   * is filled they are the same mark — but a semibreve is a different glyph,
   * about a third again as wide. It is printed too seldom to sway a median
   * taken over a whole page, so learned as one shape it comes out a crotchet,
   * and then every whole note fails to match it.
   *
   * Sorting the marks into two kinds and averaging each separately was the
   * first attempt, and it learned the wrong division: heads with the stem on
   * the left against heads with the stem on the right, that being the largest
   * difference between patches rather than the meaningful one. So the second
   * shape is derived rather than learned — this page's own notehead, stretched
   * sideways by the ratio engraving keeps between the two.
   */
  const wideData = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = Math.round(rx + (x - rx) / 1.35);
      wideData[y * w + x] = src >= 0 && src < w ? data[y * w + src] : 0;
    }
  }
  const widened = templateFrom(wideData, rx, ry, used.length);

  /**
   * And the bar each has to clear, read off the page as well.
   *
   * Every notehead here is one of the marks the template was made from, so how
   * badly the worst of them matches it is how badly a real notehead can match
   * on this engraving: anything above that is a note as far as this page is
   * concerned. A little below the tenth-worst leaves room for the heads that
   * were never sampled, and the fixed bounds either side are rails against a
   * page whose marks are all alike — which would set the bar absurdly high —
   * or all unlike, absurdly low.
   */
  for (const t of [learned, widened]) {
    const scores = used.map((u) => matchOne(solid, t, u.x, u.y)).sort((a, b) => a - b);
    const low = scores[Math.floor(scores.length * 0.1)];
    t.cut = Math.min(0.72, Math.max(0.4, low - 0.08));
  }
  return [learned, widened];
}

/**
 * Find noteheads on one staff.
 *
 * Score every position, then keep the peaks — rather than accept everything
 * that clears a bar, which lets one head be found several times over and its
 * neighbour not at all.
 */
export function findHeads(
  clean: Bitmap,
  staff: RawStaff,
  startX = 0,
  solid = fillHoles(clean, staff.spacing),
  textBands: Array<[number, number]> = [],
  /** How far off the staff to look, when a neighbouring staff is closer than
   * the usual reach — see `readPage`. */
  reach: [number, number] = [Infinity, Infinity],
  templates: HeadTemplate[] = learnHeadTemplate(solid, [staff]),
): Array<{ x: number; y: number; step: number; filled: boolean }> {
  const sp = staff.spacing;
  const rx = sp * 0.62;
  const ry = sp * 0.46;
  const yTop = Math.max(0, Math.round(staff.top - Math.min(sp * 4.5, reach[0])));
  const yBot = Math.min(clean.h - 1, Math.round(staff.bottom + Math.min(sp * 4.5, reach[1])));
  // Past the clef and the key signature. A fixed distance from the left edge is
  // not enough: where a bracket joins the staves it *is* the left edge, and the
  // clef then sits inside the margin and gets read as a pair of noteheads.
  const xFrom = Math.round(Math.max(staff.left + sp * 4.2, startX));
  const stride = Math.max(1, Math.round(sp / 8));

  // Engraved proportions, loosely bounded: a notehead is 1.3 staff spaces wide
  // and one tall, and these are wide enough that no real head is outside them.
  // They are here to keep the scoring away from stems and beams, which are the
  // wrong size by a factor rather than by a margin.
  const minW = sp * 0.75;
  const maxW = sp * 2.2;
  const minH = sp * 0.68;
  // Two spaces, not one: seconds in close harmony are printed head on head,
  // and measuring how tall the ink is through the middle of the upper one
  // measures both of them. A ceiling that only fits a single head threw the
  // upper note of every stacked pair away. Nothing else vertical gets in on
  // this — a stem or a barline is a tenth of the width a notehead has to be.
  const maxH = sp * 2.5;

  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (let y = yTop; y <= yBot; y += stride) {
    // The words printed between the staves are not music, however like a
    // notehead one of their letters may look.
    if (textBands.some(([a, b]) => y >= a && y <= b)) continue;
    for (let x = xFrom; x <= staff.right; x += stride) {
      if (!ink(solid, x, y)) continue;
      const wide = 1 + run(solid, x, y, -1, 0, maxW) + run(solid, x, y, 1, 0, maxW);
      if (wide < minW || wide > maxW) continue;
      const tall = 1 + run(solid, x, y, 0, -1, maxH) + run(solid, x, y, 0, 1, maxH);
      if (tall < minH || tall > maxH) continue;
      const score = headScore(solid, x, y, sp);
      if (score <= 0.62) continue;
      // Off the staff, a notehead has to prove it is one: the page keeps its
      // words and its numbers out there, and they are the same size and shape.
      const at = Math.round((staff.lines[4] - y) / (sp / 2));
      if (at < -1 || at > 9) {
        if (!hasLedger(clean, staff, x, at) && !hasStem(clean, x, y, sp)) continue;
      }
      candidates.push({ x, y, score });
    }
  }

  /**
   * One detection per notehead — and, just as important, one per notehead
   * rather than one per neighbourhood.
   *
   * Two notes a second apart are printed touching, one on a line and the next
   * in the space above, overlapping sideways so they both fit. Suppressing by a
   * plain rectangle around each head, as this used to, throws the second one
   * away: it is well within a notehead's width of the first. But a second is
   * ordinary music — it is most of the chords in close-harmony writing — and
   * losing the lower note of one is losing a note of the piece.
   *
   * The trouble is that a second and a head found twice over look the same from
   * a distance: both are two marks about half a space apart. No radius tells
   * them apart, because there is nothing to tell — the difference is not in how
   * far apart the readings are but in whether they are readings of the same
   * thing. So each one is walked uphill to the best-scoring position near it
   * first. Two readings of one head arrive at the same summit and become one;
   * two heads have their own summits and both survive.
   */
  const climb = (c: { x: number; y: number; score: number }) => {
    let { x, y, score } = c;
    for (let step = Math.max(1, Math.round(sp / 6)); step >= 1; step >>= 1) {
      for (let moved = true; moved; ) {
        moved = false;
        for (const [dx, dy] of [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ]) {
          // Never further than a quarter-space vertically: that is enough to
          // settle onto the middle of the head this reading came from, and not
          // enough to walk into the head a half-space above it. Without that
          // bound the two heads of a second climb into each other and merge.
          if (Math.abs(x + dx - c.x) > sp * 0.6 || Math.abs(y + dy - c.y) > sp * 0.28) continue;
          const s = headScore(solid, x + dx, y + dy, sp);
          if (s > score + 1e-6) {
            x += dx;
            y += dy;
            score = s;
            moved = true;
          }
        }
      }
    }
    return { x, y, score };
  };

  candidates.sort((a, b) => b.score - a.score);
  const peaks: typeof candidates = [];
  for (const c of candidates) {
    // Cheap first pass, so that only a handful of climbs are needed per head.
    if (peaks.some((k) => Math.abs(k.x - c.x) <= 1 && Math.abs(k.y - c.y) <= 1)) continue;
    peaks.push(climb(c));
  }

  const step = (y: number) => Math.round((staff.lines[4] - y) / (sp / 2));

  /**
   * Ranked by how well they read *and* by how squarely they sit on the staff.
   *
   * Notes live on the half-space lattice — on a line or in a space, never
   * between. That is worth something when two of them are printed one on top of
   * the other, as a second in close harmony is: the ink of the pair is a single
   * tall blob, and its middle reads as a fine notehead, so a third note appears
   * between the two real ones. It is the one reading of the three that is half
   * a space off the lattice, and preferring the ones that are on it settles the
   * matter without having to guess at a distance.
   */
  const offLattice = (y: number) => Math.abs((staff.lines[4] - y) / (sp / 2) - step(y));
  peaks.sort((a, b) => b.score - 0.35 * offLattice(b.y) - (a.score - 0.35 * offLattice(a.y)));
  const kept: typeof candidates = [];
  for (const c of peaks) {
    const duplicate = kept.some(
      (k) =>
        // The same summit, reached from two directions — or the phantom
        // between two heads that touch, which is nearer to both than a real
        // note ever is to its neighbour.
        (Math.abs(k.x - c.x) <= sp * 0.35 && Math.abs(k.y - c.y) <= sp * 0.44) ||
        // Or the same pitch at the same moment, which is not music.
        (step(k.y) === step(c.y) && Math.abs(k.x - c.x) < sp * 1.3),
    );
    if (duplicate) continue;
    // The last word: does this look like the noteheads this page prints? Size
    // and solidity got it this far, and both are satisfied by things that are
    // not notes — a sharp with its cells painted in most of all.
    if (!matches(solid, templates, c.x, c.y)) continue;
    kept.push(c);
  }

  return kept
    .map((k) => ({
      x: k.x,
      y: k.y,
      // Snap to the nearest half-space: a notehead always sits on a line or in
      // a space, so rounding here removes a pixel of detection jitter.
      step: step(k.y),
      // Hollow or filled, read from the ink as it was printed. Only ever a
      // description of a note already found — never a way of finding one, which
      // is what it used to be and why half notes went missing.
      filled: ellipseInk(clean, k.x, k.y, rx * 0.38, ry * 0.38) > 0.55,
    }))
    .sort((a, b) => a.x - b.x);
}

// --- barlines --------------------------------------------------------------

/**
 * Where the measures end.
 *
 * The app reads no rhythm and wants none, but it cannot avoid measures: an
 * accidental printed on a note holds for the rest of its bar and stops dead at
 * the next barline. Without knowing where the bars are, a sharp either applies
 * to one note when the page means several, or to the whole line when the page
 * means one — and both are wrong pitches with nothing on screen to say so.
 *
 * A barline is the one thing that runs the full height of the staff and no
 * further. A stem comes close but always falls short of both lines at once, and
 * where a beamed group makes a long one, it has a notehead attached — so
 * anything standing next to a notehead is not a barline.
 */
export function findBarlines(
  clean: Bitmap,
  staff: RawStaff,
  heads: Array<{ x: number }>,
): number[] {
  const sp = staff.spacing;
  const top = Math.round(staff.top);
  const bottom = Math.round(staff.bottom);
  const height = bottom - top + 1;
  if (height < 5) return [];
  const need = Math.round(height * 0.96);

  const full: number[] = [];
  for (let x = Math.round(staff.left); x <= Math.round(staff.right); x++) {
    let n = 0;
    for (let y = top; y <= bottom; y++) if (clean.data[y * clean.w + x]) n++;
    if (n >= need) full.push(x);
  }

  const out: number[] = [];
  for (let i = 0; i < full.length; ) {
    let j = i;
    while (j + 1 < full.length && full[j + 1] - full[j] <= 2) j++;
    const centre = (full[i] + full[j]) / 2;
    // A stem stands beside its notehead; a barline stands alone.
    if (!heads.some((h) => Math.abs(h.x - centre) < sp * 1.1)) out.push(centre);
    i = j + 1;
  }
  return out;
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
  let endX = Math.max(clefEnd, sharp.endX, flat.endX);

  /**
   * And past the time signature, if one is printed after the key.
   *
   * Its digits are the last thing at the head of a staff that is the size of a
   * notehead — a 2, a 4, a 0 are all roughly one space across and rounded — and
   * being printed inside the staff they have every ledger line and stem they
   * could need to look like music. They were read as notes.
   *
   * What they are not is a note with a stem, which is the other tall thing that
   * can stand here. A time signature is two digits filling the staff from the
   * top line to the bottom, so ink runs the width of it nearly all the way
   * down; a note is a head with a thread hanging off it, thin over most of its
   * height. That is the measurement, and it does not care which digits they are
   * or whether they are 4/4, 6/8 or a great C.
   */
  for (const g of glyphs) {
    if (g.x0 <= endX || g.x0 - endX > sp * 3.5) continue;
    const w = g.x1 - g.x0 + 1;
    const h = g.y1 - g.y0 + 1;
    if (w > sp * 2.4 || h < sp * 3.2) break;
    if (bandWidth(clean, g, 0.1, 0.9, 'typical') < 0.42) break;
    endX = g.x1;
  }

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

/**
 * Read one rendered page. `local` picks the thresholder that copes with uneven
 * lighting, which a photograph needs and a rendered PDF does not.
 */
export function readPage(image: ImageData, pageIndex: number, local = false): PageReading {
  const bm = toBitmap(image, local);
  const raw = findStaves(bm);
  if (!raw.length) return { staves: [], notes: [] };

  const clean = removeStaffLines(bm, raw);
  // Noteheads are looked for in a copy with their holes painted in, so that a
  // half note is the same shape as a quarter note. One pass over the page does
  // for every staff on it — the staves of a page are engraved at one size.
  const spacing = raw.map((s) => s.spacing).sort((a, b) => a - b)[raw.length >> 1];
  const solid = fillHoles(clean, spacing);
  const textBands = findTextBands(clean, raw);
  // What a notehead looks like here, taken from this page's own printing.
  const templates = learnHeadTemplate(solid, raw);
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
        bars: [],
      });

      // How far above and below to look for notes on ledger lines. Two staves
      // close together would otherwise both claim the notes in the gap, and the
      // same notehead read against two staves is two different pitches — the
      // one kind of error the reader must not make silently. The halfway line
      // decides, because a note there belongs to whichever staff is nearer.
      const above = raw[staffIndex - 1];
      const below = raw[staffIndex + 1];
      const reach: [number, number] = [
        above ? (s.top - above.bottom) / 2 : Infinity,
        below ? (below.top - s.bottom) / 2 : Infinity,
      ];
      const heads = findHeads(clean, s, key.endX + s.spacing * 0.6, solid, textBands, reach, templates);
      staves[staves.length - 1].bars = findBarlines(clean, s, heads);
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
