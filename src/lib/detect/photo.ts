/**
 * Turning a photograph into a page.
 *
 * A PDF arrives already flat, evenly lit and square to the page. A photo of the
 * music on a stand arrives none of those things, and the rest of the pipeline
 * assumes all three: staves are found by projecting ink onto the vertical axis,
 * which only works if the lines are level, and ink is separated from paper by a
 * single brightness threshold, which only works if the light is even.
 *
 * So a photo is straightened and evened out here, before anything tries to read
 * it. What comes out is an ordinary page — and, importantly, the same one the
 * app then shows you, because you tap the picture on screen and the notes were
 * found in its coordinates.
 */

/** Beyond this, detail costs memory without buying accuracy. */
const TARGET_WIDTH = 2200;
/** Phone cameras hand back far more than this; anything larger is downscaled. */
const MAX_PIXELS = 12e6;

/**
 * Decode an image file. `createImageBitmap` handles everything a browser knows
 * natively; the `<img>` fallback exists for iPhone photos, which arrive as HEIC
 * that Safari can display but not always decode into a bitmap directly.
 */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      // Revoking immediately is safe: the image is decoded and drawn by now.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }
}

/** Greyscale, at a size where measuring is cheap. */
function grey(
  source: CanvasImageSource,
  w: number,
  h: number,
): { g: Uint8Array; w: number; h: number } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) {
    g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  c.width = 0;
  c.height = 0;
  return { g, w, h };
}

/**
 * How far the page is rotated, in radians.
 *
 * Staff lines are the strongest horizontal thing on any page of music, so the
 * angle that stacks the most ink into the fewest rows is the angle that makes
 * them level. Trying every angle and keeping the one whose row profile is most
 * concentrated is slow to describe and fast to run — the profile only needs the
 * ink, and at this size there is not much of it.
 *
 * A degree of tilt is enough to smear five lines into one grey band and lose
 * the staff entirely, which is why this matters more than it sounds.
 */
function skewAngle(g: Uint8Array, w: number, h: number): number {
  // Ink, by a rough global cut. The angle search only needs to know where the
  // dark pixels are, not exactly which ones count.
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i];
  const cut = (sum / g.length) * 0.82;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y * w + x] < cut) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;

  const cx = w / 2;
  const rows = new Float64Array(h + 2);
  let bestAngle = 0;
  let bestScore = -1;
  for (let deg = -7; deg <= 7; deg += 0.2) {
    const slope = Math.tan((deg * Math.PI) / 180);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const y = ys[i] - (xs[i] - cx) * slope;
      if (y < 0 || y >= h) continue;
      rows[y | 0]++;
    }
    // Concentration: the same ink in fewer rows squares up larger.
    let score = 0;
    for (let r = 0; r < h; r++) score += rows[r] * rows[r];
    if (score > bestScore) {
      bestScore = score;
      bestAngle = deg;
    }
  }
  return (bestAngle * Math.PI) / 180;
}

/**
 * A photo, straightened and sized for reading.
 *
 * The lighting is left alone here — evening it out is the thresholder's job,
 * and it does a better one working from the full-size page than this could do
 * by rewriting the pixels the user is going to look at.
 */
export async function renderPhoto(file: File): Promise<HTMLCanvasElement> {
  const source = await decode(file);
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) throw new Error('That image could not be opened.');

  const fit = Math.min(1, TARGET_WIDTH / sw, Math.sqrt(MAX_PIXELS / (sw * sh)));
  const w = Math.max(1, Math.round(sw * fit));
  const h = Math.max(1, Math.round(sh * fit));

  // Measure the tilt small and correct it large.
  const probeW = Math.min(w, 720);
  const probe = grey(source, probeW, Math.max(1, Math.round((h * probeW) / w)));
  const angle = skewAngle(probe.g, probe.w, probe.h);

  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const out = document.createElement('canvas');
  out.width = Math.ceil(w * cos + h * sin);
  out.height = Math.ceil(w * sin + h * cos);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(-angle);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if ('close' in source && typeof source.close === 'function') source.close();
  return out;
}
