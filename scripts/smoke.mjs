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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// An engraved PDF says where its noteheads are, and they are read from the
// file rather than found in a picture of it. Nothing is inferred, so nothing
// is uncertain — and a reading with any doubt in it means the glyph path
// silently stopped firing and the pixels quietly took over, which would show
// up as nothing worse than a slower, slightly worse import.
const certainty = await page.evaluate(() => {
  const n = window.__cn.getState().score.notes;
  return {
    // Present *and* certain. Accepting a missing field here would pass against
    // a build that predates the field entirely, which is exactly the stale
    // build this check exists to catch.
    sure: n.filter((x) => typeof x.confidence === 'number' && x.confidence >= 1).length,
    total: n.length,
  };
});
check(
  "an engraved PDF's noteheads are read from the file, not from the picture",
  certainty.total > 0 && certainty.sure === certainty.total,
  `${certainty.sure} of ${certainty.total} certain`,
);

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

// A tap does not have to be dead centre. Height decides the pitch, so a couple
// of millimetres to the side is still obviously the same note — landing on the
// bare staff instead used to sound something else entirely.
const nearMiss = await page.evaluate(async () => {
  const s = window.__cn.getState();
  const sc = s.score;
  /**
   * A note with room around it, rather than simply the first one.
   *
   * The taps below land a space and a half to either side, and on a densely
   * engraved page that is where the *next* note is — so the tap selected its
   * neighbour, which is the app reading the page correctly and the check
   * calling it a miss. What is being tested is that a tap need not be dead
   * centre, and that only means anything where there is nothing else nearby
   * for it to have meant.
   */
  const spaced = (n) => {
    const st = sc.staves.find((x) => x.id === n.staff);
    if (!st) return false;
    return !sc.notes.some(
      (o) => o.id !== n.id && o.staff === n.staff && Math.abs(o.x - n.x) < st.spacing * 2.6,
    );
  };
  const n = sc.notes.find(spaced) ?? sc.notes[0];
  const st = sc.staves.find((x) => x.id === n.staff);
  const pg = sc.pages.find((p) => p.index === n.page);
  const svg = document.querySelectorAll('main svg')[sc.pages.indexOf(pg)];
  const r = svg.getBoundingClientRect();
  const at = (dx, dy) => ({
    clientX: r.left + ((n.x + dx) / pg.width) * r.width,
    clientY: r.top + ((n.y + dy) / pg.height) * r.height,
  });
  const hits = [];
  for (const [dx, dy] of [
    [0, 0],
    [st.spacing * 1.6, 0],
    [-st.spacing * 1.6, 0],
    [0, st.spacing * 0.4],
    [0, -st.spacing * 0.4],
  ]) {
    s.select(null);
    const p = at(dx, dy);
    svg.dispatchEvent(
      new PointerEvent('pointerdown', { ...p, pointerId: 1, pointerType: 'mouse', bubbles: true }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', { ...p, pointerId: 1, pointerType: 'mouse', bubbles: true }),
    );
    await new Promise((r2) => setTimeout(r2, 60));
    hits.push(window.__cn.getState().selected === n.id);
  }
  return hits;
});
check(
  'a tap slightly off a notehead still hits it',
  nearMiss.every(Boolean),
  `${nearMiss.filter(Boolean).length} of ${nearMiss.length} offsets`,
);
check(
  'and the note it would play is marked on the page',
  (await page.locator('[data-aim="note"]').count()) > 0,
);

// A pitch where no note was found is still reachable, but only on purpose.
// Landing on one by accident, between the notes, was the commonest way to be
// surprised by this app — so a plain click there now shows the spot and says
// nothing, and alt (a press held still, on a phone) is what sounds it.
const empty = await page.evaluate(() => {
  const s = window.__cn.getState();
  const sc = s.score;
  for (const st of sc.staves) {
    const notes = sc.notes.filter((n) => n.staff === st.id);
    if (!notes.length) continue;
    const pg = sc.pages.find((p) => p.index === st.page);
    const ordinal = sc.pages.indexOf(pg);
    const svg = document.querySelectorAll('main svg')[ordinal];
    if (!svg) continue;
    // Well clear of every notehead, but still on the staff.
    for (let x = st.left + st.spacing * 6; x < st.right; x += st.spacing) {
      for (const y of [st.top, st.lines[2], st.bottom]) {
        const clear = notes.every(
          (n) => Math.abs(n.y - y) > st.spacing * 1.8 || Math.abs(n.x - x) > st.spacing * 3.2,
        );
        if (clear) return { ordinal, x: x / pg.width, y: y / pg.height };
      }
    }
  }
  return null;
});

if (!empty) check('a plain click between the notes stays silent', false, 'nowhere empty enough');
else {
  const overlay = page.locator('main svg').nth(empty.ordinal);
  await overlay.scrollIntoViewIfNeeded();
  const eb = await overlay.boundingBox();
  const at = { x: eb.x + eb.width * empty.x, y: eb.y + eb.height * empty.y };

  const rangCount = () => page.evaluate(() => window.__cn.getState().ringing.length);
  const quietBefore = await rangCount();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  check('a plain click between the notes stays silent', (await rangCount()) === quietBefore);
  check(
    'and it still shows the pitch it would have played',
    (await page.locator('[data-aim="staff"]').count()) === 1,
  );

  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);
  check('holding alt sounds the pitch there', (await rangCount()) > quietBefore);
}

// Gliding along a staff plays the notes as they pass, which is the only way to
// hear a phrase as a shape rather than as a list. Where two voices share a
// staff — most of choral music — the finger's height picks between them, so
// tracing the upper line hears the upper line.
const run = await page.evaluate(() => {
  const sc = window.__cn.getState().score;
  const st = sc.staves.find((x) => sc.notes.filter((n) => n.staff === x.id).length >= 6);
  const notes = sc.notes.filter((n) => n.staff === st.id).sort((a, b) => a.x - b.x);
  const span = notes.slice(0, 8);
  // Noteheads stacked at the same moment are one event, not several.
  const columns = [[span[0]]];
  for (let i = 1; i < span.length; i++) {
    const here = columns[columns.length - 1];
    if (Math.abs(span[i].x - here[0].x) < st.spacing * 0.8) here.push(span[i]);
    else columns.push([span[i]]);
  }

  /**
   * Traced along where each voice is *printed*, which is not the same as along
   * the top and bottom of the staff.
   *
   * Taking the staff's own edges was the obvious thing and it was wrong: the
   * two voices of a barbershop stave both sit low, the second of them a couple
   * of spaces below the bottom line, so a finger at the bottom edge is still
   * nearer to the upper voice than to the lower one and duly hears it. The test
   * then failed while the app was doing exactly what it promises — a finger
   * follows the notes it can see, and these are where they are.
   */
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const stacked = columns.filter((c) => c.length > 1);
  const rows = (pick) => mean(stacked.map((c) => pick([...c].sort((a, b) => a.y - b.y)).y));
  const pg = sc.pages.find((p) => p.index === st.page);
  return {
    ordinal: sc.pages.indexOf(pg),
    columns: columns.length,
    voices: stacked.length,
    from: span[0].x / pg.width,
    to: span[span.length - 1].x / pg.width,
    high: (stacked.length ? rows((c) => c[0]) : st.top) / pg.height,
    low: (stacked.length ? rows((c) => c[c.length - 1]) : st.bottom) / pg.height,
  };
});
const runSvg = page.locator('main svg').nth(run.ordinal);
await runSvg.scrollIntoViewIfNeeded();
const rb = await runSvg.boundingBox();

const glideAlong = async (yFrac) => {
  await page.evaluate(() => {
    window.__run = [];
    const real = window.__cn.getState().sound;
    window.__realSound = real;
    window.__cn.setState({
      sound: (m) => {
        window.__run.push(m);
        real(m);
      },
    });
  });
  const y = rb.y + rb.height * yFrac;
  await page.mouse.move(rb.x + rb.width * run.from, y);
  await page.mouse.down();
  let playhead = 0;
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(rb.x + rb.width * (run.from + ((run.to - run.from) * i) / 16), y);
    await page.waitForTimeout(25);
    playhead = Math.max(playhead, await page.locator('[data-playhead]').count());
  }
  await page.mouse.up();
  const heard = await page.evaluate(() => {
    window.__cn.setState({ sound: window.__realSound });
    return window.__run;
  });
  return { heard, playhead };
};

const upper = await glideAlong(run.high);
const lower = await glideAlong(run.low);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
check(
  'dragging along a staff plays the notes in turn',
  upper.heard.length >= run.columns - 1,
  `${upper.heard.length} notes over ${run.columns} moments`,
);
check('and a playhead shows where the glide has reached', upper.playhead === 1);
check(
  'the finger height picks the voice, where a staff carries two',
  !run.voices || mean(upper.heard) > mean(lower.heard),
  run.voices
    ? `high ${mean(upper.heard).toFixed(1)} · low ${mean(lower.heard).toFixed(1)}`
    : 'no stacked voices on this staff',
);

// Correcting a pitch.// Correcting a pitch.
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

// Recognition will always miss something, so a miss has to be repairable.
// A note put in by hand is a real note: it plays, it is saved, and it takes
// part in a glide like any other.
const added = await page.evaluate(() => {
  const s = window.__cn.getState();
  const st = s.score.staves[0];
  const before = s.score.notes.length;
  const note = s.addNoteAt(st.page, st.id, st.right - st.spacing * 2, st.lines[2]);
  const after = window.__cn.getState().score;
  return {
    before,
    after: after.notes.length,
    onLattice: note ? note.step === 4 : false,
    selected: after.notes.some((n) => n.id === window.__cn.getState().selected),
    findable: after.notes.some((n) => n.id === note?.id),
    id: note?.id,
  };
});
check(
  'a note the reader missed can be put in by hand',
  added.after === added.before + 1 && added.findable && added.onLattice,
  `${added.before} → ${added.after} notes`,
);
check('and it is selected, ready to correct', added.selected);

// And the other way: a note that is not on the page comes off, corrections
// and all, rather than haunting every glide over that bar forever.
const removed = await page.evaluate((id) => {
  const s = window.__cn.getState();
  s.setAlter(id, 1);
  s.removeNote(id);
  const after = window.__cn.getState().score;
  return { count: after.notes.length, gone: !after.notes.some((n) => n.id === id), alters: id in after.alters };
}, added.id);
check(
  'and a note that is not there can be taken off',
  removed.gone && removed.count === added.before,
  `${added.after} → ${removed.count} notes`,
);
check('with its corrections, rather than leaving them to attach to something else', !removed.alters);

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
      /**
       * Which accidental to print, chosen so that it says something.
       *
       * A sharp on a note the key has already sharpened is not a change — it
       * is the same pitch written twice — so testing with a sharp on a score
       * in five sharps proves nothing and looks like a failure. The one to
       * print is whichever moves this note off where the key put it.
       */
      s.setAlter(a.id, null);
      const plain = hear(a.id);
      s.setAlter(a.id, 1);
      let alter = 1;
      let shift = hear(a.id) - plain;
      if (!shift) {
        s.setAlter(a.id, -1);
        alter = -1;
        shift = hear(a.id) - plain;
      }
      if (!shift) continue;

      s.setAlter(a.id, null);
      const beforeSame = hear(later.id);
      const beforeNext = beyond ? hear(beyond.id) : null;
      s.setAlter(a.id, alter);
      const afterSame = hear(later.id);
      const afterNext = beyond ? hear(beyond.id) : null;
      s.setAlter(a.id, null);
      return { beforeSame, afterSame, beforeNext, afterNext, shift, hasNext: !!beyond };
    }
  }
  return null;
});
check(
  'an accidental carries to the rest of its bar',
  rule != null && rule.afterSame === rule.beforeSame + rule.shift,
  rule
    ? `${rule.beforeSame} → ${rule.afterSame} (${rule.shift > 0 ? '♯' : '♭'})`
    : 'no two notes share a line within a bar',
);
check(
  'and stops at the barline',
  rule != null && (!rule.hasNext || rule.afterNext === rule.beforeNext),
  rule?.hasNext ? `${rule.beforeNext} → ${rule.afterNext}` : 'no note of that line in a later bar',
);

// Parts. Which line a note belongs to is not read off the page — it is told,
// and the whole point of telling it is what happens next: the part plays alone
// and the rest of the score gets out of the way.
const sorted = await page.evaluate(() => {
  const s = window.__cn.getState();
  const n = s.autoAssignParts();
  const sc = window.__cn.getState().score;
  const tally = {};
  for (const p of Object.values(sc.partOf)) tally[p] = (tally[p] ?? 0) + 1;
  // The top voice of the top staff is the first part, whether that staff
  // carries one voice or two.
  const staff = sc.staves.find((x) => x.positionInSystem === 0);
  const notes = sc.notes.filter((x) => x.staff === staff.id).sort((a, b) => a.x - b.x);
  const column = notes
    .filter((x) => Math.abs(x.x - notes[0].x) < staff.spacing * 0.8)
    .sort((a, b) => a.y - b.y);
  return {
    n,
    total: sc.notes.length,
    used: Object.keys(tally).length,
    top: sc.partOf[column[0]?.id],
    first: sc.parts[0].id,
  };
});
check(
  'sorting by staff puts every note in a part',
  sorted.n === sorted.total,
  `${sorted.n} of ${sorted.total} notes across ${sorted.used} parts`,
);
check('and the top voice of the top staff is the first part', sorted.top === sorted.first);

const soloed = await page.evaluate(async () => {
  const s = window.__cn.getState();
  const sc = s.score;
  const mine = sc.notes.find((n) => sc.partOf[n.id] === sc.parts[0].id);
  const theirs = sc.notes.find(
    (n) => sc.partOf[n.id] && sc.partOf[n.id] !== sc.parts[0].id && n.page === mine.page,
  );
  s.setCurrentPart(sc.parts[0].id);
  await new Promise((r) => setTimeout(r, 200));

  const svg = document.querySelectorAll('main svg')[sc.pages.findIndex((p) => p.index === mine.page)];
  svg.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 200));
  const pg = sc.pages.find((p) => p.index === mine.page);
  const r = svg.getBoundingClientRect();
  // Counted at the store rather than read off `ringing`, which is capped and
  // decays on a timer — a check that has to be told what silence sounds like
  // must not be able to mistake a full list for one.
  let played = 0;
  const real = window.__cn.getState().sound;
  window.__cn.setState({
    sound: (m) => {
      played++;
      real(m);
    },
  });
  const tap = async (n) => {
    const before = played;
    const at = {
      clientX: r.left + (n.x / pg.width) * r.width,
      clientY: r.top + (n.y / pg.height) * r.height,
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
    };
    svg.dispatchEvent(new PointerEvent('pointerdown', at));
    svg.dispatchEvent(new PointerEvent('pointerup', at));
    await new Promise((x) => setTimeout(x, 150));
    return played > before;
  };
  const own = await tap(mine);
  const other = theirs ? await tap(theirs) : false;
  window.__cn.setState({ sound: real });
  return { own, other, hadOther: !!theirs };
});
check('a soloed part still sounds when tapped', soloed.own);
check(
  'and a note of another part stays silent',
  !soloed.hadOther || !soloed.other,
  soloed.hadOther ? '' : 'no other part on that page',
);
check('the rest of the page is veiled', (await page.locator('[data-veil]').count()) > 0);
check('and the note it will not play is named for its part', (await page.locator('[data-aim="muted"]').count()) > 0);

// The payoff: trace the line and hear only that line, whichever voice of the
// staff the finger happens to be nearest.
const alone = await page.evaluate(async () => {
  const s = window.__cn.getState();
  const sc = s.score;
  const heard = [];
  const real = s.soundNote;
  window.__cn.setState({
    soundNote: (n) => {
      heard.push(sc.partOf[n.id] ?? null);
      real(n);
    },
  });
  await new Promise((r) => setTimeout(r, 120));

  const busy = (x) => sc.notes.filter((n) => n.staff === x.id).length >= 6;
  const staff =
    sc.staves.find((x) => x.positionInSystem === 0 && busy(x)) ?? sc.staves.find(busy);
  if (!staff) return { count: 0, parts: [], why: 'no staff with six notes' };
  const pg = sc.pages.find((p) => p.index === staff.page);
  const svg = document.querySelectorAll('main svg')[sc.pages.indexOf(pg)];
  svg.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 200));
  const r = svg.getBoundingClientRect();
  const notes = sc.notes.filter((n) => n.staff === staff.id).sort((a, b) => a.x - b.x);
  const y = r.top + (notes[0].y / pg.height) * r.height;
  const send = (type, x) =>
    svg.dispatchEvent(
      new PointerEvent(type, {
        clientX: r.left + (x / pg.width) * r.width,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
      }),
    );
  send('pointerdown', notes[0].x - staff.spacing);
  for (let i = 1; i <= 20; i++) {
    send('pointermove', notes[0].x - staff.spacing + (i / 20) * (staff.right - notes[0].x));
  }
  send('pointerup', staff.right);
  await new Promise((x) => setTimeout(x, 150));
  window.__cn.setState({ soundNote: real });
  return { count: heard.length, parts: [...new Set(heard)] };
});
check(
  'a glide plays the soloed part and nothing else',
  alone.count > 2 && alone.parts.length === 1,
  alone.why ?? `${alone.count} notes, ${alone.parts.length} part(s)`,
);

// Tagging, and the way back out of it: the same tap takes the note off again,
// which on a phone is the only undo there is.
const tags = await page.evaluate(async () => {
  const s = window.__cn.getState();
  s.setCurrentPart(s.score.parts[2].id);
  s.setTagging(true);
  await new Promise((r) => setTimeout(r, 150));

  const sc = window.__cn.getState().score;
  const n = sc.notes.find((x) => sc.partOf[x.id] === sc.parts[0].id);
  const pg = sc.pages.find((p) => p.index === n.page);
  const svg = document.querySelectorAll('main svg')[sc.pages.indexOf(pg)];
  svg.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 200));
  const r = svg.getBoundingClientRect();
  const at = {
    clientX: r.left + (n.x / pg.width) * r.width,
    clientY: r.top + (n.y / pg.height) * r.height,
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
  };
  const tap = async () => {
    svg.dispatchEvent(new PointerEvent('pointerdown', at));
    svg.dispatchEvent(new PointerEvent('pointerup', at));
    await new Promise((x) => setTimeout(x, 150));
    return window.__cn.getState().score.partOf[n.id] ?? null;
  };
  const into = await tap();
  const back = await tap();
  s.setTagging(false);
  return { into, back, third: sc.parts[2].id };
});
check('a tap while tagging moves the note into that part', tags.into === tags.third);
check('and tapping it again takes it back out', tags.back === null);

// Tagging a score you cannot save is a score you tag twice.
const savedParts = await page.evaluate(async () => {
  const s = window.__cn.getState();
  const id = s.score.id;
  const expected = Object.keys(s.score.partOf).length;
  await new Promise((r) => setTimeout(r, 700));
  s.closeScore();
  await s.openScore(id);
  const sc = window.__cn.getState().score;
  return { expected, found: Object.keys(sc.partOf ?? {}).length, part: window.__cn.getState().currentPart };
});
check(
  'parts are saved with the score',
  savedParts.found === savedParts.expected && savedParts.expected > 0,
  `${savedParts.found} of ${savedParts.expected} kept`,
);
check('and a score opens whole, not soloed', savedParts.part === null);

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
// A beam is the one thing on a page that is the right size and darkness to be
// read as a notehead: where it slants past a stem, the corner at the end of a
// beamed group is about a space wide and, at the old floor, tall enough to
// pass. So here is a page with beams and stems on it and no noteheads at all —
// anything found on it is found wrongly.
const beamPage = path.join(os.tmpdir(), `clefnotes-beams-${Date.now()}.png`);
fs.writeFileSync(
  beamPage,
  Buffer.from(
    await page.evaluate(() => {
      const sp = 16;
      const c = document.createElement('canvas');
      c.width = 1400;
      // Tall enough that the local-average thresholder averages over paper
      // rather than over the bar it is standing on — the same reason its
      // window is a fraction of the page rather than a fixed number of pixels.
      c.height = 1200;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      for (let i = 0; i < 5; i++) g.fillRect(40, 520 + i * sp, 1320, 2);

      // Beamed groups at several slants and thicknesses, with the stems that
      // make the corners. A real rasteriser softens the edges and the
      // thresholder then reads them a shade fatter, which is what took a beam
      // over the old floor, so the same softening is applied here.
      g.filter = 'blur(0.7px)';
      const group = (x0, x1, y0, y1, thick) => {
        g.fillRect(x0, 528, 2.6, y0 - 528);
        g.fillRect(x1, 528, 2.6, y1 - 528);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.lineTo(x1, y1 + thick);
        g.lineTo(x0, y0 + thick);
        g.closePath();
        g.fill();
      };
      // Shallow beams are already rejected for running too far sideways; the
      // ones that got through are steep, where a row crosses the bar in about
      // the width of a notehead.
      group(220, 380, 570, 618, sp * 0.5);
      group(450, 610, 618, 566, sp * 0.58);
      group(690, 850, 568, 620, sp * 0.64);
      group(930, 1090, 620, 568, sp * 0.7);
      group(1160, 1330, 572, 616, sp * 0.55);
      g.filter = 'none';
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  ),
);
await page.evaluate(() => window.__cn.getState().closeScore());
await page.locator('input[type=file]').first().setInputFiles(beamPage);
let beamRead = null;
for (let i = 0; i < 60; i++) {
  beamRead = await page.evaluate(() => {
    const s = window.__cn.getState();
    return {
      loading: s.loading,
      error: s.error,
      staves: s.score?.staves.length ?? 0,
      notes: s.score?.notes.length ?? 0,
    };
  });
  if (beamRead.error || (!beamRead.loading && beamRead.staves > 0)) break;
  await page.waitForTimeout(500);
}
fs.unlinkSync(beamPage);
check(
  'a page of beams and stems is read as a staff',
  !beamRead.error && beamRead.staves === 1,
  beamRead.error ?? `${beamRead.staves} staves`,
);
check(
  'and no noteheads are found in the beams',
  beamRead.notes === 0,
  `${beamRead.notes} imagined`,
);

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
