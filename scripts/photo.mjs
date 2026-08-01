/**
 * Photograph check.
 *
 * A picture of the page is not a PDF: it arrives tilted, unevenly lit and
 * slightly soft, and every one of those breaks a different stage — staves are
 * found by projecting ink onto the vertical axis, which needs level lines, and
 * ink is told from paper by brightness, which needs even light.
 *
 * Rather than ship a photograph as a fixture, this makes one: it imports a PDF,
 * takes the page the app itself rendered, tilts it, shades one corner, softens
 * and re-compresses it, and feeds that back in as a JPEG. The PDF import is
 * then the answer key — the same page, read twice, once the easy way.
 *
 *   npm run build && npm run preview &
 *   node scripts/photo.mjs path/to/score.pdf
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const PDF = process.argv[2];
if (!PDF) {
  console.error('Pass a PDF to test with: node scripts/photo.mjs score.pdf');
  process.exit(2);
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const settle = async () => {
  for (let i = 0; i < 240; i++) {
    const s = await page.evaluate(() => {
      const st = window.__cn.getState();
      return { loading: st.loading, error: st.error, notes: st.score?.notes.length ?? 0 };
    });
    if (s.error || (!s.loading && s.notes > 0)) return s;
    await page.waitForTimeout(1000);
  }
  return { loading: true, error: 'timed out', notes: 0 };
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('input[type=file]').first().setInputFiles(PDF);
const pdfRun = await settle();
check('the PDF imports, for something to compare against', !pdfRun.error, pdfRun.error ?? '');

// The page with the most notes on it — the fairest one to photograph.
const shot = await page.evaluate(async () => {
  const sc = window.__cn.getState().score;
  const tally = new Map();
  for (const n of sc.notes) tally.set(n.page, (tally.get(n.page) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [p, n] of tally) if (n > bestCount) ((best = p), (bestCount = n));
  const pg = sc.pages.find((p) => p.index === best);

  const im = new Image();
  im.src = pg.image;
  await im.decode();

  // A hand-held shot: a couple of degrees of tilt, a shadow across one corner,
  // a little softness, and JPEG at the quality a phone actually writes.
  const angle = (2.4 * Math.PI) / 180;
  const c = document.createElement('canvas');
  c.width = Math.ceil(pg.width * Math.cos(angle) + pg.height * Math.sin(angle));
  c.height = Math.ceil(pg.width * Math.sin(angle) + pg.height * Math.cos(angle));
  const g = c.getContext('2d');
  g.fillStyle = '#cfc9bd';
  g.fillRect(0, 0, c.width, c.height);
  g.save();
  g.translate(c.width / 2, c.height / 2);
  g.rotate(angle);
  g.filter = 'blur(0.6px)';
  g.drawImage(im, -pg.width / 2, -pg.height / 2);
  g.restore();

  const shade = g.createLinearGradient(0, 0, c.width, c.height);
  shade.addColorStop(0, 'rgba(0,0,0,0.34)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.04)');
  shade.addColorStop(1, 'rgba(0,0,0,0.30)');
  g.fillStyle = shade;
  g.fillRect(0, 0, c.width, c.height);

  return { data: c.toDataURL('image/jpeg', 0.7), page: best, notes: bestCount };
});

const file = path.join(os.tmpdir(), `clefnotes-photo-${Date.now()}.jpg`);
fs.writeFileSync(file, Buffer.from(shot.data.split(',')[1], 'base64'));

await page.evaluate(() => window.__cn.getState().closeScore());
await page.locator('input[type=file]').first().setInputFiles(file);
const photoRun = await settle();
check('a photograph of the page imports', !photoRun.error, photoRun.error ?? '');

const got = await page.evaluate(() => {
  const sc = window.__cn.getState().score;
  return {
    staves: sc?.staves.length ?? 0,
    notes: sc?.notes.length ?? 0,
    hollow: sc?.notes.filter((n) => !n.filled).length ?? 0,
  };
});

check(
  'the staves are found through the tilt and the shadow',
  got.staves > 0,
  `${got.staves} staves`,
);
check(
  'most of the noteheads survive the photograph',
  got.notes >= shot.notes * 0.75,
  `${got.notes} of ${shot.notes} from the PDF`,
);
check(
  'and not a flood of imaginary ones',
  got.notes <= shot.notes * 1.35,
  `${got.notes} of ${shot.notes}`,
);
check('hollow noteheads survive too', got.hollow > 0, `${got.hollow} hollow`);
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

fs.unlinkSync(file);
await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
