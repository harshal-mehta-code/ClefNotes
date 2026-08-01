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
const atDoor = async () => (await page.locator('text=Choose a file').count()) === 1;
check('the app loads to the drop zone', await atDoor());

// A device that used an earlier ClefNotes still holds scores in the shape that
// version saved. Reading a page count off one of those took the whole app down
// to a white screen, which no static site can diagnose after the fact.
await page.evaluate(
  () =>
    new Promise((done) => {
      const req = indexedDB.open('clefnotes');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('scores')) return done();
        const tx = db.transaction('scores', 'readwrite');
        tx.objectStore('scores').put({
          id: 'legacy-shape',
          title: 'Saved by an older version',
          addedAt: Date.now(),
          openedAt: Date.now(),
          musicxml: '<score-partwise/>',
        });
        tx.oncomplete = () => {
          db.close();
          done();
        };
        tx.onerror = () => done();
      };
      req.onerror = () => done();
    }),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check(
  'a score from an older version does not blank the app',
  (await atDoor()) && (await page.locator('text=ClefNotes stopped').count()) === 0,
);
errors.length = 0;

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

// Hollow heads — minims and semibreves — are half the notation and were once
// missed wholesale, because erasing the staff lines erased their outlines too.
// Nothing said so: they simply were not there, and clicking one sounded
// whatever the click height happened to mean.
const heads = await page.evaluate(() => {
  const n = window.__cn.getState().score.notes;
  return { hollow: n.filter((x) => !x.filled).length, filled: n.filter((x) => x.filled).length };
});
check(
  'hollow noteheads are found too, not just filled ones',
  heads.hollow > heads.filled * 0.04,
  `${heads.hollow} hollow · ${heads.filled} filled`,
);
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

// The readout is the only way to tell whether the app agrees with the page.
check('the note that sounded is named on screen', (await page.locator('text=Heard').count()) === 1);

// Clicking bare staff still gives the right pitch — the safety net for a
// notehead the detector missed.
await page.evaluate(() => window.__cn.getState().select(null));
const before = await page.evaluate(() => window.__cn.getState().ringing.length);
await svg.click({ position: { x: box.width * 0.62, y: box.height * first.y } });
const staffPeak = await level();
const after = await page.evaluate(() => window.__cn.getState().ringing.length);
check(
  'clicking bare staff sounds the pitch there',
  staffPeak > 0.005 || after > before,
  `peak ${staffPeak.toFixed(4)}`,
);

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
check(
  'arrow keys correct a note',
  pitchAfter === pitchBefore + 1,
  `${pitchBefore} → ${pitchAfter}`,
);

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
check(
  'the piano roll follows the page in view',
  roll.visible === roll.target,
  `page ${roll.visible + 1}`,
);

// Accidentals. A sharp printed beside a note is the difference between the
// right pitch and a semitone off, and nothing on screen would say which — so
// they are read, and they are correctable.
const acc = await page.evaluate(() => {
  const sc = window.__cn.getState().score;
  const marked = sc.notes.filter((n) => n.accidental != null);
  return { marked: marked.length, notes: sc.notes.length, first: marked[0]?.id ?? null };
});
check(
  'printed accidentals are read, and sparingly',
  acc.marked / acc.notes < 0.25,
  `${acc.marked} of ${acc.notes} notes`,
);

// Setting one sounds it, so the pitch that comes out is what gets checked.
const fixed = await page.evaluate(() => {
  const s = window.__cn.getState();
  const id = s.score.notes[0].id;
  s.setAlter(id, -1);
  const flat = window.__cn.getState().ringing.at(-1);
  s.setAlter(id, 1);
  const sharp = window.__cn.getState().ringing.at(-1);
  return { flat, sharp };
});
check(
  'saying what is printed on a note retunes it',
  fixed.sharp - fixed.flat === 2,
  `♭ ${fixed.flat} · ♯ ${fixed.sharp}`,
);

// An accidental holds to the end of its bar, on that line, and stops there.
// Printing one on an earlier note has to move the later ones with it, and has
// to leave the next bar alone.
const rule = await page.evaluate(() => {
  const s = window.__cn.getState();
  const sc = s.score;
  const printed = (n) => (n.id in (sc.alters ?? {}) ? sc.alters[n.id] : (n.accidental ?? null));
  // The line a note names, allowing for a correction — the same comparison the
  // rule itself makes. An earlier check nudges a note, and matching on the
  // printed step alone would pair up two notes that are no longer on one line.
  const line = (n) => n.step + (sc.nudges[n.id] ?? 0);
  for (const st of sc.staves) {
    const bars = st.bars ?? [];
    if (!bars.length) continue;
    const notes = sc.notes.filter((n) => n.staff === st.id).sort((a, b) => a.x - b.x);
    for (let i = 0; i < notes.length; i++) {
      const a = notes[i];
      const later = notes.find(
        (n) =>
          n.x > a.x &&
          line(n) === line(a) &&
          printed(n) === null &&
          !bars.some((x) => x > a.x && x <= n.x),
      );
      if (!later) continue;
      const beyond = notes.find(
        (n) =>
          n.x > a.x &&
          line(n) === line(a) &&
          printed(n) === null &&
          bars.some((x) => x > a.x && x <= n.x),
      );
      const hear = (id) => {
        s.soundNote(sc.notes.find((n) => n.id === id));
        return window.__cn.getState().ringing.at(-1);
      };
      s.setAlter(a.id, null);
      const beforeSame = hear(later.id);
      const beforeNext = beyond ? hear(beyond.id) : null;
      s.setAlter(a.id, 1);
      const afterSame = hear(later.id);
      const afterNext = beyond ? hear(beyond.id) : null;
      return { beforeSame, afterSame, beforeNext, afterNext, hasNext: !!beyond };
    }
  }
  return null;
});
check(
  'an accidental carries to the rest of its bar',
  rule != null && rule.afterSame === rule.beforeSame + 1,
  rule ? `${rule.beforeSame} → ${rule.afterSame}` : 'no two notes share a line within a bar',
);
check(
  'and stops at the barline',
  rule != null && (!rule.hasNext || rule.afterNext === rule.beforeNext),
  rule?.hasNext ? `${rule.beforeNext} → ${rule.afterNext}` : 'no note of that line in a later bar',
);

// Zoom has to reach the page itself, or it does nothing on the screen where a
// notehead is smallest and a fingertip is largest.
const zoomed = await page.evaluate(async () => {
  const wide = () => document.querySelector('main img').getBoundingClientRect().width;
  const before = wide();
  window.__cn.getState().setZoom(2);
  await new Promise((r) => setTimeout(r, 300));
  const after = wide();
  window.__cn.getState().setZoom(1);
  await new Promise((r) => setTimeout(r, 300));
  return {
    before,
    after,
    scrolls:
      document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth,
  };
});
check(
  'zooming in makes the page bigger',
  zoomed.after > zoomed.before * 1.6,
  `${Math.round(zoomed.before)}px → ${Math.round(zoomed.after)}px`,
);

// The overlay must not eat scrolling. It once set touch-action:none over every
// page, so a swipe to turn the page was read as a drag across the notes.
const touch = await page.evaluate(() => {
  const svg = document.querySelector('main svg');
  return getComputedStyle(svg).touchAction;
});
check('the page can still be scrolled and pinched', touch !== 'none', `touch-action: ${touch}`);

// The tail of a note. The envelope is scheduled as a list of automation events
// and the browser sorts them by time, so a release whose end time landed before
// the decay's turned into a fade to silence followed by a swell back up and
// then a hard stop. That is audible and was, so the shape gets measured.
const tail = await page.evaluate(async () => {
  const p = window.__player;
  p.createMeter();
  await p.play(69, 1.1);
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 2400) {
    out.push(p.outputLevel());
    await new Promise((r) => setTimeout(r, 20));
  }
  return out;
});
const loudest = Math.max(...tail);
let swell = 0;
let quietest = Infinity;
for (let i = tail.indexOf(loudest) + 1; i < tail.length; i++) {
  const v = tail[i] / loudest;
  quietest = Math.min(quietest, v);
  // A rise well clear of the floor, after the sound had already died away.
  if (v > 0.02 && v > quietest * 3) swell = Math.max(swell, v);
}
check(
  'a note fades out rather than swelling back and clicking off',
  loudest > 0.01 && swell === 0,
  swell ? `rose back to ${(swell * 100).toFixed(0)}% of peak` : `peak ${loudest.toFixed(3)}`,
);

check('the keyboard is on screen', (await page.locator('canvas').count()) >= 1);
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
