/**
 * End-to-end smoke test.
 *
 * Drives a real browser against a production build. The checks are deliberately
 * about the two things the whole app rests on: that a PDF yields staves and
 * noteheads, and that clicking one actually makes a sound.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs path/to/score.pdf
 *
 * Set CHROME to override the browser binary.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? undefined;
const PDF = process.argv[2];

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!PDF) {
  console.error('Pass a PDF to test with: node scripts/smoke.mjs score.pdf');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('the app loads to the drop zone', (await page.locator('text=Drop a PDF here').count()) === 1);

await page.locator('input[type=file]').first().setInputFiles(PDF);

let info = null;
for (let i = 0; i < 180; i++) {
  info = await page.evaluate(() => {
    const s = window.__cn.getState();
    return {
      loading: s.loading,
      error: s.error,
      staves: s.score?.staves.length ?? 0,
      notes: s.score?.notes.length ?? 0,
      pages: s.score?.pages.length ?? 0,
    };
  });
  if (info.error || (!info.loading && info.staves > 0)) break;
  await page.waitForTimeout(1000);
}

check('the PDF imports', !info.error, info.error ?? '');
check('staves are found', info.staves > 0, `${info.staves} staves on ${info.pages} pages`);
check('noteheads are found', info.notes > 0, `${info.notes} notes`);
check('the page image is shown, not a re-engraving', (await page.locator('main img').count()) > 0);

// The whole product: click a notehead, hear it.
const level = async (ms = 1400) =>
  await page.evaluate(async (d) => {
    const p = window.__player;
    let peak = 0;
    const t = performance.now();
    while (performance.now() - t < d) {
      // The context only exists once a gesture has started audio, so keep
      // trying to attach the meter rather than giving up before it appears.
      p.createMeter();
      peak = Math.max(peak, p.outputLevel());
      await new Promise((r) => setTimeout(r, 20));
    }
    return peak;
  }, ms);

const first = await page.evaluate(() => {
  const s = window.__cn.getState();
  const n = s.score.notes[0];
  const st = s.score.staves.find((x) => x.id === n.staff);
  const pg = s.score.pages.find((p) => p.index === n.page);
  // Which overlay this note is on, counting only pages that were rendered.
  const pageOrdinal = s.score.pages.findIndex((p) => p.index === n.page);
  return { x: n.x / pg.width, y: n.y / pg.height, page: n.page, pageOrdinal, staffClef: st.clef };
});

// Click through the element so Playwright scrolls it into view first — the
// pages are tall and a raw viewport coordinate lands nowhere.
const svg = page.locator('main svg').nth(first.pageOrdinal);
await svg.scrollIntoViewIfNeeded();
const box = await svg.boundingBox();
await svg.click({ position: { x: box.width * first.x, y: box.height * first.y } });
const clickPeak = await level();
check('clicking a notehead sounds it', clickPeak > 0.005, `peak ${clickPeak.toFixed(4)}`);

const selected = await page.evaluate(() => window.__cn.getState().selected);
check('clicking selects the note for correction', selected != null);

// Clicking bare staff still gives the right pitch — the safety net for a
// notehead the detector missed.
await page.evaluate(() => window.__cn.getState().select(null));
const before = await page.evaluate(() => window.__cn.getState().ringing.length);
await svg.click({ position: { x: box.width * 0.62, y: box.height * first.y } });
const staffPeak = await level();
const after = await page.evaluate(() => window.__cn.getState().ringing.length);
check('clicking bare staff sounds the pitch there', staffPeak > 0.005 || after > before, `peak ${staffPeak.toFixed(4)}`);

// Correcting a pitch.
await page.evaluate(() => {
  const s = window.__cn.getState();
  s.select(s.score.notes[0].id);
});
const pitchBefore = await page.evaluate(() => {
  const s = window.__cn.getState();
  const n = s.score.notes[0];
  const st = s.score.staves.find((x) => x.id === n.staff);
  return window.__cn.getState().score.nudges[n.id] ?? 0;
});
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(400);
const pitchAfter = await page.evaluate(() => {
  const s = window.__cn.getState();
  return s.score.nudges[s.score.notes[0].id] ?? 0;
});
check('arrow keys correct a note', pitchAfter === pitchBefore + 1, `${pitchBefore} → ${pitchAfter}`);

// Setting a clef applies to that staff on every system — the difference
// between one tap and twenty-three on a choral chart.
const clefs = await page.evaluate(() => {
  const s = window.__cn.getState();
  const first = s.score.staves[0];
  const changed = s.setStaffClef(first.id, 'treble8');
  const after = window.__cn.getState().score.staves;
  const peers = after.filter((x) => x.positionInSystem === first.positionInSystem);
  return {
    changed,
    peers: peers.length,
    allSet: peers.every((x) => x.clef === 'treble8'),
    othersUntouched: after
      .filter((x) => x.positionInSystem !== first.positionInSystem)
      .every((x) => x.clef !== 'treble8'),
  };
});
check(
  'a clef applies to the same staff on every system',
  clefs.allSet && clefs.othersUntouched && clefs.peers > 1,
  `${clefs.changed} of ${clefs.peers} staves`,
);

// Key signatures. Every staff should end up with a key, the two staves of a
// system must agree (they are braced together and cannot differ), and a change
// can only happen where a new system begins.
const keys = await page.evaluate(() => {
  const st = window.__cn.getState().score.staves;
  const bySystem = new Map();
  for (const s of st) {
    const k = `${s.page}:${s.system}`;
    if (!bySystem.has(k)) bySystem.set(k, []);
    bySystem.get(k).push(s.sharps);
  }
  const systems = [...bySystem.values()];
  return {
    unset: st.filter((s) => s.sharps == null).length,
    disagree: systems.filter((v) => v.some((x) => x !== v[0])).length,
    distinct: [...new Set(st.map((s) => s.sharps))].sort((a, b) => a - b),
  };
});
check('every staff has a key signature', keys.unset === 0, `${keys.unset} without one`);
check(
  'staves of a system share one key',
  keys.disagree === 0,
  `${keys.disagree} systems disagree · keys ${keys.distinct.join(', ')}`,
);

// The piano roll follows the page you are looking at.
const roll = await page.evaluate(async () => {
  const s = window.__cn.getState();
  const withNotes = [...new Set(s.score.notes.map((n) => n.page))].sort((a, b) => a - b);
  const target = withNotes[withNotes.length - 1];
  document.querySelector(`[data-page="${target}"]`)?.scrollIntoView();
  await new Promise((r) => setTimeout(r, 1200));
  return { target, visible: window.__cn.getState().visiblePage };
});
check('the piano roll follows the page in view', roll.visible === roll.target, `page ${roll.visible + 1}`);

check('the keyboard is on screen', (await page.locator('canvas').count()) >= 1);
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
