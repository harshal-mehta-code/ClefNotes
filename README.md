# ClefNotes

**Sheet music in, playable part-by-part music out.**

Drop in a score and ClefNotes engraves it, plays it, lights each note as it
sounds, and gives every part its own track — so you can solo your line, mute it
and play along with the rest, slow the hard bar to 40%, and hear the words sung
back to you.

It is free, it runs entirely in the browser, and it needs no account, no server
and no API key. Your scores never leave the device.

---

## Why it works this way

Three constraints shaped every technical decision:

**It has to be free.** So there is no backend. ClefNotes is a static site: the
recognition, the synthesis, the singing and the storage all happen in your
browser. Hosting it costs nothing, and nothing can be metered or shut off.

**It has to be honest.** Optical music recognition is never perfect, and a wrong
note destroys more trust than a missing feature earns. So imports are tiered by
how much they can be trusted, and the app tells you which tier you got.

**Sight and sound must never disagree.** A cursor that drifts from the audio is
worse than no cursor at all.

That last one drove the core design. Verovio engraves the score *and* produces
the timemap that playback is scheduled from, so the note that lights up is by
construction the note that sounds. Everything — the moving cursor, the
highlighted notehead, the karaoke syllable, the bar/beat readout — is a *view*
of `AudioContext.currentTime`. Nothing drives the clock; everything reads it.

---

## Getting your music in

Four routes, best first. The import screen names which one you got.

| Route | Accuracy | How |
| --- | --- | --- |
| **MusicXML / `.mxl`** | Exact | Every note, lyric and marking, straight in |
| **PDF with a score inside** | Exact | MuseScore attaches the real MusicXML to its PDF exports — ClefNotes finds and unpacks it, no recognition needed |
| **MIDI** | Exact pitch and rhythm | Notation details (beaming, spelling) are inferred |
| **PDF → recognition** | Best effort | The built-in OMR reads clean printed scores |

The fastest route to a perfect import is a MusicXML export — MuseScore,
Sibelius, Finale and Dorico all produce one.

### About the recognition

The OMR is a classical computer-vision pipeline, not a model, because it has to
run offline and ship inside a static site: Otsu threshold → horizontal
projection for staff lines → staff-line removal → shape-tested notehead
detection → stem/beam analysis for durations → barlines.

**It is genuinely beta.** On a clean, printed, un-skewed score it recovers most
of the notes; on the test score used during development it found 59 of 84. It
will not read handwriting, and a skewed or faint scan will defeat it. Treat its
output as a draft to check against the page, which is why the import screen
shows the original alongside. Clef, key and time signature are not detected —
it assumes treble/bass by staff position, C major and 4/4.

---

## What's in it

**Studio** — engraved score with note-level highlighting, piano roll, or both
split. Per-part instrument, volume, pan and octave. Solo, mute, and
**minus-one** (mute your part, the ensemble plays around you). Ten one-click
sound packs — choir, orchestra, chapel organ, jazz combo, lo-fi, 8-bit, music
box, baroque. Tempo 28–220 BPM plus a 25–200% speed multiplier, both without
touching pitch. Loop any bar range by dragging across the score. Step mode to
walk note by note. Metronome, count-in, transpose, swing, humanise, reverb.

**Practice Lab** — a trouble map where bars redden as you keep going back to
them, and one tap builds a drill from just those bars. A tempo ramp where each
clean pass unlocks +5%. Live pitch scoring from the microphone via YIN
autocorrelation, with a tuning meter in cents. Streaks, XP and per-score
mastery.

**ClefVox** — a formant singing synthesiser. Lyric syllables are mapped to IPA
vowels, each vowel sets three formant frequencies, and a glottal pulse train at
the note's pitch is filtered through them. Consonants are shaped noise bursts;
vibrato and breath sit on top. Soprano, alto, tenor, bass, choir ×6, children
and robot voices, and one-click **SATB learning tracks** — your part sings the
words at full volume while the others stay underneath. It sounds synthetic on
purpose; a rehearsal track should sound like a guide, not a performance.

**Library** — local, offline, no account. A shelf of public-domain scores ships
with the app. A daily sight-reading phrase is generated fresh at your grade,
the same for everyone on a given date. Export the whole library as one JSON
file; that is the sync story. Export any score as WAV (rendered offline,
exactly what you hear), MIDI, or MusicXML.

Light and dark themes, keyboard shortcuts throughout, installable as a PWA.

### Keyboard

`space` play/pause (or advance, in step mode) · `←` `→` step · `esc` stop ·
`l` loop · `m` metronome · `[` `]` tempo ∓4

---

## Running it

```bash
npm install
npm run dev          # development
npm run build        # production build into dist/
npm run preview      # serve the build
npm run smoke        # end-to-end browser checks against the preview
```

`dist/` is a static bundle — put it on any static host. For a project-scoped
path such as GitHub Pages, set the base:

```bash
BASE=/ClefNotes/ npm run build
```

The Verovio WASM is ~7.5 MB and loads lazily on first score, then is cached by
the service worker.

---

## How it's built

| Layer | Choice | Why |
| --- | --- | --- |
| App | Vite + React + TypeScript | Static output, no server to pay for |
| Engraving | Verovio (WASM) | MusicXML → SVG **and** a timemap, from one pass |
| Playback | Custom Web Audio scheduler | Lookahead scheduling against the audio clock; tempo changes mid-phrase without drift |
| Instruments | Synthesised | Sample libraries need bandwidth and a host; these are a few hundred bytes each |
| Singing | Formant synthesis | No model, no API, no per-note cost |
| PDF | pdf.js | Rasterising and attachment extraction, client-side |
| Pitch detection | YIN autocorrelation | Tracks the period, so it works when the fundamental is weak |
| Storage | IndexedDB via Dexie | No account, instant, works offline |

### Layout

```
src/
  lib/
    verovio/engraver.ts   Engraving + the playback model, from one pass
    score/                Score DSL → MusicXML, MIDI import, phrase generator
    audio/                Transport, instruments, ClefVox, pitch, WAV render
    import/               File sniffing, PDF tiers, the OMR pipeline
    db/                   Dexie schema, practice stats, streaks
  components/             studio · lab · vox · library
  data/scores/            The bundled shelf
```

---

## The bundled shelf

Deliberately small: only tunes that could be encoded correctly. A wrong note in
a music app costs more trust than a thin demo library does.

- **Ode to Joy** — Beethoven's melody with a four-part chorale setting written
  for this project. Words by Henry van Dyke (1907).
- **Frère Jacques** — traditional, as a four-part round.
- **Row, Row, Row Your Boat** — traditional, three-part round in 6/8.
- **Twinkle, Twinkle, Little Star** — traditional; words by Jane Taylor (1806).

All public domain. The harmonisations are original to this project.

---

## Known limits

- OMR does not detect clefs, key signatures or time signatures, and misses
  notes beyond two ledger lines (the band is kept tight to avoid reading
  lyrics as noteheads).
- MIDI import keeps the top voice where a track contains chords, since a
  monophonic line is more useful for practice.
- Importing from a URL only works where the host allows cross-origin reads;
  with no server there is nothing to proxy through. The app says so and tells
  you to download the file instead.
- ClefVox maps English spelling to vowels by rule, not by dictionary. An
  odd-sounding word means a vowel guessed wrong — never a wrong note.
