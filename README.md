# ClefNotes

**Bring in a PDF, or photograph the page. Tap any note and hear it.**

You get your own score back — the page exactly as it was printed — with every
notehead made playable. Tap one to hear that pitch, and tap along a line to hear
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
half-recognised page is still a useful page — but it is a safety net, not the
main road: a tap lands on a notehead whenever one is plausibly what you meant.

The whole model is: *position → pitch → sound.* That is one inference, and it is
the one that is reliable.

---

## What's in it

**Import.** A PDF, a scan, a screenshot, or a photo taken there and then — the
camera button opens straight into it on a phone. Several photos become the
pages of one score, since sheet music is rarely one page and that is how anyone
would shoot it.

**Aim, then hear.** A marker shows what a tap is about to play before it plays
it — a ring around the notehead it will hit, or, where there is no note, a ghost
sitting on the exact line or space that will sound, with the name beside it. On
a phone the note sounds when your finger lifts, so the marker appears while it
is still down and there is a moment to move it.

Which note a tap means is decided by height, because height *is* the pitch: a
tap anywhere within a notehead's own line or space is that notehead, and one a
half-space high is a different note rather than a near miss. Sideways the target
is far wider, since the next note along is further away than a fingertip is
wide. Judging both directions alike, as this used to, meant a tap a couple of
millimetres off the side fell through to bare staff and sounded something else.

**The sheet.** Your page, page by page, with a transparent layer over it that
knows where the staves and noteheads are. Detected notes carry a faint dot, so
you can see what the app found — toggle it off when you want a clean page.
Hovering shows the pitch under the pointer.

**Zoom.** `−` and `+` widen the page itself rather than the window, so it stays
sharp, and a zoomed page pans sideways. It matters most on a phone, where a
notehead is a couple of millimetres across and a fingertip is not — which is
where it used to be hidden, on the theory that a page already filling the screen
had nothing left to zoom.

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

**What you just heard, named.** Every tap puts the pitch on screen — `F♯4` —
which is the only way to tell whether the app agrees with the page in front of
you. Beside it are `♭` `♮` `♯`: they say what is *printed* on the note, which is
something you can read straight off the page, rather than asking you which way
the pitch ought to move. Tap the lit one to say there is nothing printed there
after all. Corrected notes turn gold, and the correction is saved with the
score. (With a keyboard, `↑` `↓` also move a note a step and `shift ↑` `↓` an
octave, for the rarer case of a notehead read onto the wrong line.)

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
run-length shape tests for filled noteheads and a ring test for hollow ones →
key signature at the head of each staff → accidentals printed beside each
notehead.

A photograph needs two things a PDF does not. It is **straightened** first:
staff lines are the strongest horizontal thing on a page of music, so the tilt
that stacks the most ink into the fewest rows is the tilt that makes them level,
and a single degree is enough to smear five lines into one grey band and lose
the staff entirely. And it is thresholded **against the local average** rather
than one number for the whole page, because a corner in shadow is darker than
the printed staff lines in the bright corner, and no global cut can separate
those. A rendered PDF is flat and evenly lit by construction and keeps the
simpler treatment.

Pages are rendered and recognised **one at a time** and released before the
next: a page at this resolution is ~30 MB of pixels, and holding a seven-page
score in memory at once is enough for a phone to kill the tab.

Staves are grouped into systems by looking for the barline running through the
gap between them, not by measuring the gap. On real choral music the space
within a system and the space between systems are near enough identical, and the
gap heuristic collapsed a two-part score into four.

Pitch is then pure geometry — the number of half-spaces from the bottom staff
line — mapped through the clef and the key.

Erasing the staff lines is more delicate than it looks, and getting it wrong is
invisible rather than obvious. The rule is that ink standing tall at a line
belongs to something else and survives; how tall counts as tall used to be
guessed from the staff spacing, generously. Generously enough to erase *hollow*
noteheads, whose outline is a few pixels of ink where a filled head is a whole
staff space of it. Half notes and whole notes came out of it shredded into
arcs and were then found by nothing, while every quarter note came through
perfectly — so the failure looked like a quirk of certain notes rather than a
line-removal bug. Each line now measures itself: along most of its length a
staff line has nothing on it but itself, which makes the median run height
along it the line's own thickness, at any resolution and in any engraving.

Hollow heads are then found as a **ring**: paper in the middle, ink in an
annulus around it, and no ink much beyond that. The area measure matters. The
obvious test — probe outward from the middle and look for the rim in four
directions — meets the outline at exactly four pixels, so one broken pixel
loses the note, and at this size most heads have a break somewhere, usually
where the stem joins. What stops a beam gap or the counter of a lyric from
reading as a notehead is that the paper inside a head *stops*: a gap between
beams is ringed the same way but runs on out of the ring.

Where a staff begins is the longest unbroken run of ink along its middle line,
not the leftmost ink on that row — a part name like "Melody" is printed exactly
there, and everything measured from the staff's left edge then starts in the
wrong place. That one had a treble clef being read as a pair of noteheads.

Key signatures are read the same way — by position, not by shape. The sharps
and the flats of a key signature are printed in fixed orders that start in
completely different places (F♯ on the top line of a treble staff, B♭ on the
middle line) and never coincide, so counting how many marks fall on consecutive
expected positions gives both the count and the direction at once. Shape alone
does not: at this resolution a flat frequently comes apart into a bowl and a
stem, and a lone bowl looks much like a sharp. Where the marks do not fit either
pattern the staff reports nothing rather than a guess, and inherits the key in
force — which is what a key signature does anyway.

Barlines are read too, and only for one reason: an accidental printed on a note
holds for the rest of *that bar*, on that staff, at that exact line or space —
so a bar can carry four F♯s and print only the first. Reading only the printed
one plays the other three a semitone flat with nothing on screen to say so, and
carrying it past the barline is wrong in the other direction. A barline is the
one thing that runs the full height of the staff and no further; a stem comes
close but always falls short of both lines at once, and where a beamed group
makes a long one it has a notehead attached, so anything standing beside a
notehead is not a barline.

**What it does not read**, by design: durations, rests, ties, slurs, dynamics,
articulation, repeats, time signatures. None of them are needed to answer "what
does this note sound like", and every one of them is a way to be wrong.

Accidentals printed beside a notehead are read too, and they have to be: a note
carrying a sharp sounds a semitone wrong without one, and nothing on screen says
so — the app and the page disagree and only the page is right. What makes them
findable in open music is that an accidental *hugs* its notehead, where a rest
or the previous note sits a beat away, so the search reaches about two staff
spaces to the left and no further. Everything else is shape: engraving fixes an
accidental at roughly two to three staff spaces tall and much taller than it is
wide, which a beam, a notehead and a time signature all fail.

Telling the three apart needs one more distinction than it looks. A sharp is
wide at the top and the bottom, a flat is a stem over a bowl, a natural is two
half-height strokes — but measured by the *widest* row, a natural's top quarter
just catches its upper crossbar and is exactly as wide as a sharp's. Every
natural in the test score read as a sharp until the measure changed to the
*typical* row. At the head of a staff the opposite holds, because there a flat
often arrives as a bare bowl with its stem lost in the threshold, and only the
widest row still says "bowl" — so the two readings use the two statistics, on
purpose.

On the seven-page barbershop chart this was tuned against, that finds 62
accidentals across 985 notes and gets one or two of them wrong.

---

## Running it

```bash
npm install
npm run dev          # development
npm run build        # production build into dist/
npm run preview      # serve the build
npm run smoke -- score.pdf   # end-to-end browser checks against the preview
npm run mobile -- score.pdf  # the same app at phone width, with real touch
npm run photo -- score.pdf   # the same page again, as a photograph
```

The smoke test drives a real browser against the production build, imports a
PDF you point it at, clicks a notehead, and measures the **master audio bus** to
confirm sound actually came out. That last part matters: an earlier version
verified audio with an offline render, which passed happily while live playback
was completely silent.

The photo run needs no fixture: it imports the PDF, takes the page the app
itself rendered, tilts it, shades a corner, softens it and re-compresses it as a
JPEG, then feeds that back in. The PDF import is the answer key — the same page,
read twice, once the easy way. On the test chart 210 of 219 noteheads survive the
round trip.

The mobile run is separate because nothing it checks can fail at desktop width.
A swipe has to scroll the page and stay silent, a tap has to sound one note, the
zoom control has to exist and reach the page, and everything in the header has
to fit on screen. All four were broken at once on a phone while the desktop
suite was green.

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

- Accidental detection is good, not perfect: roughly one in forty is imagined
  or missed, usually where a beam crowds the notehead. Tap the note and set it.
- Double sharps and double flats are not read, and cannot be set.
- An accidental is carried to the rest of its bar on the same line, which is the
  rule; it is not carried into a tied note across a barline, which is also the
  rule but needs ties, and ties are not read.
- Handwritten and heavily ornamented scores read poorly; the detector expects
  clean printed engraving.
- A photo has to be square-on and filling the frame. Tilt is corrected, but
  perspective — the page leaning away from the camera, so the lines converge —
  is not, and that is the usual reason a photo finds no staves.
- On a photograph, the counter of a lyric letter under the staff is occasionally
  read as a hollow notehead.
- Grace notes, cue notes and small ossia staves are treated like anything else.
- A tempo mark printed above the first staff can leave a note-shaped mark or
  two at the start of a piece.
- Noteheads more than about two ledger lines away from a staff are skipped, to
  avoid reading lyric text as notes.
- There is no playback of a passage in time, on purpose. Clicking is the whole
  interaction, and it is the part that is trustworthy.
