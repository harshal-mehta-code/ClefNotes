/**
 * End-to-end smoke test.
 *
 * Drives a real browser against a production build and checks the things that
 * are easy to break and hard to notice: that parts stay separate, that a note
 * lights up while it sounds, and that the transport actually moves.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs
 *
 * Set CHROME to override the browser binary.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? undefined;

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

check('shelf seeds into the library', (await page.locator('article').count()) >= 4);

await page.locator('article', { hasText: 'Ode to Joy' }).locator('button', { hasText: 'Open' }).click();
await page.waitForTimeout(6000);

const model = await page.evaluate(() => {
  const s = window.__cn.getState().score;
  return s && {
    parts: s.parts.length,
    lyrics: s.parts.filter((p) => p.hasLyrics).length,
    notes: s.notes.length,
    measures: s.measureCount,
    distinctParts: new Set(s.notes.map((n) => n.part)).size,
    quarterNotes: s.notes.filter((n) => Math.abs(n.qDur - 1) < 1e-6).length,
  };
});

check('score engraves with four parts', model?.parts === 4, `got ${model?.parts}`);
check('notes are spread across all parts', model?.distinctParts === 4, `got ${model?.distinctParts}`);
check('lyrics attach to every voice', model?.lyrics === 4, `got ${model?.lyrics}`);
check('durations are tempo-independent', model?.quarterNotes > 100, `${model?.quarterNotes} quarter notes`);

await page.locator('button:has-text("Play")').first().click();
await page.waitForTimeout(1500);
const a = await page.evaluate(() => ({
  q: window.__cn.getState().q,
  lit: document.querySelectorAll('.score-host g.note.cn-on').length,
}));
await page.waitForTimeout(1600);
const b = await page.evaluate(() => window.__cn.getState().q);

check('transport advances', b > a.q, `${a.q.toFixed(2)} → ${b.toFixed(2)}`);
check('sounding notes are highlighted', a.lit > 0, `${a.lit} lit`);

await page.locator('aside button[title="Mute this part"]').first().click();
await page.waitForTimeout(400);
check('muting a part fades its staves', (await page.locator('.score-host g.staff.cn-muted').count()) > 0);
await page.locator('aside button[title="Mute this part"]').first().click();

await page.locator('button:has-text("Pause")').first().click();

await page.evaluate(() => window.__cn.getState().setLoopBars([2, 4]));
await page.waitForTimeout(300);
const loop = await page.evaluate(() => {
  const s = window.__cn.getState();
  return { on: s.transport.loop, a: s.transport.loopStartQ, b: s.transport.loopEndQ };
});
check('loop range maps bars to quarter notes', loop.on && loop.a === 4 && loop.b === 16, JSON.stringify(loop));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
