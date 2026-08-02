/**
 * The same app, on a phone.
 *
 * Every complaint that has ever reached this project came from a phone, and
 * none of them could have been caught at desktop width: a swipe that fired
 * notes instead of scrolling, a zoom control that was hidden because it did
 * nothing, a header with more in it than fits. So the touch behaviour gets its
 * own run — real touch events, a real narrow viewport.
 *
 *   npm run build && npm run preview &
 *   node scripts/mobile.mjs path/to/score.pdf
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const PDF = process.argv[2];
if (!PDF) {
  console.error('Pass a PDF to test with: node scripts/mobile.mjs score.pdf');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

// Taking a photo of the page in front of you is the point of being on a phone,
// so the camera has to be one tap from the front door — and `capture` is what
// opens the camera rather than the photo library.
const camera = page.locator('text=Take a photo');
const cameraInput = page.locator('input[capture]');
const shortcut =
  (await camera.count()) === 1 &&
  (await camera.isVisible()) &&
  (await cameraInput.getAttribute('accept')) === 'image/*';

await page.locator('input[type=file]').first().setInputFiles(PDF);
for (let i = 0; i < 200; i++) {
  const s = await page.evaluate(() => {
    const st = window.__cn.getState();
    return { l: st.loading, n: st.score?.notes.length ?? 0 };
  });
  if (!s.l && s.n > 0) break;
  await page.waitForTimeout(1000);
}

const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });

const swipe = async (x, y0, y1) => {
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 10; i++) await touch('touchMove', x, y0 + ((y1 - y0) * i) / 10);
  await touch('touchEnd', x, y1);
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

check('the camera is one tap from the front door', shortcut);

// Header: everything that is meant to be reachable has to actually be on screen.
const header = await page.evaluate(() => {
  const h = document.querySelector('header');
  const kids = [...h.querySelectorAll('button, select')].filter((e) => e.offsetParent !== null);
  const right = h.getBoundingClientRect().right;
  return {
    labels: kids.map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 12)),
    overflow: kids.filter((e) => e.getBoundingClientRect().right > right + 0.5).length,
    scrollOverflow: h.scrollWidth > h.clientWidth + 1,
  };
});
check(
  'nothing in the header is cut off',
  header.overflow === 0 && !header.scrollOverflow,
  header.labels.join(' | '),
);

// A swipe scrolls the page, and sounds nothing.
await page.evaluate(() => {
  window.__cn.getState().select(null);
  window.__heard = 0;
  const s = window.__cn.getState().sound;
  window.__cn.setState({
    sound: (m) => {
      window.__heard++;
      s(m);
    },
  });
});
const beforeScroll = await page.evaluate(() => document.querySelector('main').scrollTop);
await swipe(195, 600, 200);
await page.waitForTimeout(500);
const afterScroll = await page.evaluate(() => document.querySelector('main').scrollTop);
const rang = await page.evaluate(() => window.__heard);
check(
  'swiping scrolls the page',
  afterScroll > beforeScroll + 100,
  `${beforeScroll} → ${afterScroll}`,
);
check('swiping past the notes stays silent', rang === 0, `${rang} notes sounded`);

// A tap on a notehead sounds it.
const spot = await page.evaluate(() => {
  const svg = [...document.querySelectorAll('main svg')].find((s) => {
    const r = s.getBoundingClientRect();
    return r.top < 700 && r.bottom > 120;
  });
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const sc = window.__cn.getState().score;
  const idx = [...document.querySelectorAll('main svg')].indexOf(svg);
  const pg = sc.pages[idx];
  // A note that is on screen right now.
  const notes = sc.notes.filter((n) => n.page === pg.index);
  for (const n of notes) {
    const y = r.top + (n.y / pg.height) * r.height;
    const x = r.left + (n.x / pg.width) * r.width;
    if (y > 150 && y < 640 && x > 10 && x < 380) return { x, y };
  }
  return null;
});
if (!spot) check('a tap on a notehead sounds it', false, 'no note on screen');
else {
  await page.evaluate(() => {
    window.__heard = 0;
  });
  await touch('touchStart', spot.x, spot.y);
  await page.waitForTimeout(120);
  // The note sounds on release, so between landing and lifting there is a
  // moment to see what the finger is actually on. Without that, aiming is
  // something you only find out about by hearing the wrong note.
  const previewed = await page.locator('[data-aim]').count();
  const silentSoFar = await page.evaluate(() => window.__heard);
  await touch('touchEnd', spot.x, spot.y);
  await page.waitForTimeout(400);
  const heard = await page.evaluate(() => window.__heard);
  check('a finger down shows what it is aiming at', previewed === 1 && silentSoFar === 0);
  check('a tap on a notehead sounds it', heard === 1, `${heard} sounded`);
  check(
    'and the target is still marked afterwards',
    (await page.locator('[data-aim]').count()) === 1,
  );
}

// Zoom reaches the page, and the zoomed page pans sideways.
const zoom = await page.evaluate(async () => {
  const wide = () => document.querySelector('main img').getBoundingClientRect().width;
  const before = wide();
  document.querySelector('[aria-label="Zoom in"]').click();
  document.querySelector('[aria-label="Zoom in"]').click();
  await new Promise((r) => setTimeout(r, 400));
  const main = document.querySelector('main');
  return { before, after: wide(), pans: main.scrollWidth > main.clientWidth + 4 };
});
check(
  'the zoom control is on the phone and works',
  zoom.after > zoom.before * 1.4,
  `${Math.round(zoom.before)}px → ${Math.round(zoom.after)}px`,
);
check('a zoomed page pans sideways', zoom.pans);
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
