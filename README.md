# ClefNotes

**Drop in a PDF of sheet music. Click any note on the page and hear it.**

You get your own score back — the page exactly as it was printed — with every
notehead made playable. Tap one to hear that pitch. Drag along a phrase to hear
the phrase. Pick the instrument you want it in. A piano roll and a keyboard
underneath show what you are hearing.

It is free, it runs entirely in the browser, and it needs no account, no server
and no API key. Your scores never leave the device.

---

## Why it works this way

This started as a full transcription app — recognise the score, rebuild it,
re-engrave it, play it back with a moving cursor. It read the right number of
staves and most of the noteheads, and it still sounded like different music.

The reason is that **rhythm is the least reliable thing on a page.** Pitch is
geometry: once you know where the staff lines are, a notehead's height *is* its
pitch, and that is nearly impossible to get wrong. Duration is inference —
stems, flags, beams, dots, ties — and every error compounds. One misread quaver
on page one shifts every bar after it, and a listener hears a wrong tune, not a
small mistake.

So ClefNotes does not read rhythm, and does not re-engrave anything.

**Your page stays your page.** The image you imported is what you see. Nothing
is redrawn, so nothing can come out looking like a different piece.

**Timing comes from you.** There is no transport, no tempo, no playhead. You
click, and that note sounds. The phrasing is yours, which is exactly right when
you are working out how a line goes.

**Where detection missed, pointing still works.** Click anywhere on a staff and
you hear the pitch at that height, notehead or not. The safety net means a
half-recognised page is still a useful page.

The whole model is: *position → pitch → sound.* That is one inference, and it is
the one that is reliable.

---

## What's in it

**The sheet.** Your PDF, page by page, with a transparent layer over it that
knows where the staves and noteheads are. Detected notes carry a faint dot, so
you can see what the app found — toggle it off when you want a clean page.
Hovering shows the pitch under the pointer. Zoom to taste.

**Instruments.** About twenty synthesised voices — pianos, strings, winds,
brass, organs, mallets, plucked. Synthesised rather than sampled because
samples need bandwidth and a host, and the whole app is a static file.

**Piano roll.** The notes of the page you are looking at, laid out by position
across and pitch up the side, coloured by which staff they sit on. Scrolling the
sheet scrolls the roll. Click a dot to select and hear it. It shows *shape* —
where a line climbs, where the parts cross — which is the thing that is hard to
see and easy to hear.

**Keyboard.** A piano along the bottom that lights up with whatever is
sounding, so an interval you can hear gets a name and a shape.

**Corrections.** Click a note and the arrow keys move it: `↑` `↓` a step,
`shift ↑` `↓` an octave. Corrected notes turn gold so you can see what you have
touched, and the correction is saved with the score.

**Clef per staff.** Recognition cannot see the small 8 under a tenor clef, and
the wrong clef puts a whole staff in the wrong octave. There is a picker on
every staff, sitting quietly in the margin until you go looking.

**Key signature, read per staff.** Music changes key, and one setting for a
whole piece is wrong for every note after a modulation — so each staff carries
the key printed at its own head, shown beside it in the margin. The header
control names the key where you are reading; changing it retunes every staff in
that key and leaves a later key change intact.

**Library.** Local, offline, no account. Scores live in IndexedDB on the
device.

Light and dark themes, installable as a PWA, and it works with no network once
loaded.

---

## About the recognition

A classical computer-vision pipeline, not a model, because it has to run offline
inside a static site:

Otsu threshold → horizontal projection for staff lines → staff-line removal →
run-length shape tests for noteheads, filled and hollow → key signature at the
head of each staff.

Pages are rendered and recognised **one at a time** and released before the
next: a page at this resolution is ~30 MB of pixels, and holding a seven-page
score in memory at once is enough for a phone to kill the tab.

Staves are grouped into systems by looking for the barline running through the
gap between them, not by measuring the gap. On real choral music the space
within a system and the space between systems are near enough identical, and the
gap heuristic collapsed a two-part score into four.

Pitch is then pure geometry — the number of half-spaces from the bottom staff
line — mapped through the clef and the key.

Key signatures are read the same way — by position, not by shape. The sharps
and the flats of a key signature are printed in fixed orders that start in
completely different places (F♯ on the top line of a treble staff, B♭ on the
middle line) and never coincide, so counting how many marks fall on consecutive
expected positions gives both the count and the direction at once. Shape alone
does not: at this resolution a flat frequently comes apart into a bowl and a
stem, and a lone bowl looks much like a sharp. Where the marks do not fit either
pattern the staff reports nothing rather than a guess, and inherits the key in
force — which is what a key signature does anyway.

**What it does not read**, by design: durations, rests, ties, slurs, dynamics,
articulation, repeats, time signatures. None of them are needed to answer "what
does this note sound like", and every one of them is a way to be wrong.

Deliberately unhandled: accidentals written in front of a note. Those are a
one-note exception rather than a rule for the staff, and they sit close enough
to the notehead to be confused with it — so a sharp mid-bar won't move the
pitch, and you nudge it with the arrow keys instead.

---

## Running it

```bash
npm install
npm run dev          # development
npm run build        # production build into dist/
npm run preview      # serve the build
npm run smoke -- score.pdf   # end-to-end browser checks against the preview
```

The smoke test drives a real browser against the production build, imports a
PDF you point it at, clicks a notehead, and measures the **master audio bus** to
confirm sound actually came out. That last part matters: an earlier version
verified audio with an offline render, which passed happily while live playback
was completely silent.

### Deploying

`dist/` is a static bundle with no backend, so it goes on any static host.
`vercel.json` is included and Vercel needs no configuration beyond connecting
the repository — it sets SPA rewrites, immutable caching for the hashed assets,
and always-revalidate for the shell and the service worker.

For a project-scoped path such as GitHub Pages, set the base:

```bash
BASE=/ClefNotes/ npm run build
```

---

## How it's built

| Layer | Choice | Why |
| --- | --- | --- |
| App | Vite + React + TypeScript | Static output, no server to pay for |
| PDF | pdf.js | Rasterising client-side, one page at a time |
| Recognition | Classical CV, hand-written | Runs offline; no model to download |
| Sound | Web Audio, synthesised | A preset is a few hundred bytes; samples would need a host |
| Storage | IndexedDB via Dexie | No account, instant, works offline |

The whole bundle is about 280 KB (93 KB gzipped).

### Layout

```
src/
  lib/
    detect/   types.ts   the data model — deliberately has no concept of time
              notes.ts   staves, systems, noteheads, key signatures
              pdf.ts     page-at-a-time import
    audio/    player.ts       one-shot voices, no transport
              instruments.ts  synthesis presets
  components/ Sheet · Contour · Keys · Library
  state/      store.ts   Zustand + Dexie
```

---

## Known limits

- Accidentals printed next to a note are not read — only the key signature is
  — so a note marked sharp mid-bar sounds natural until you nudge it.
- Handwritten and heavily ornamented scores read poorly; the detector expects
  clean printed engraving.
- Grace notes, cue notes and small ossia staves are treated like anything else.
- Noteheads more than about two ledger lines away from a staff are skipped, to
  avoid reading lyric text as notes.
- There is no playback of a passage in time, on purpose. Clicking is the whole
  interaction, and it is the part that is trustworthy.
