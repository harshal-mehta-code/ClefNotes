import { buildMusicXml, type ScoreSpec } from '../../lib/score/builder';

/**
 * The shelf that ships with the app, so ClefNotes is full of music on first
 * open with nothing to import and no network.
 *
 * Everything here is public domain: the melodies are traditional or long out of
 * copyright, and the harmonisations are written for this project. The shelf is
 * deliberately small — only tunes that can be encoded correctly. A wrong note in
 * a music app costs more trust than a thin demo library does.
 */

export interface ShelfEntry {
  slug: string;
  spec: ScoreSpec;
  /** One line on the library card. */
  blurb: string;
  /** Which feature this piece is the best demonstration of. */
  showcases: string;
}

// ---------------------------------------------------------------------------
// Ode to Joy — SATB. Beethoven's melody with a four-part chorale setting.
// Homorhythmic on purpose: every voice shares the rhythm, so one lyric line
// aligns across all four parts and the ClefVox learning tracks line up.
// ---------------------------------------------------------------------------

const ODE_LYRICS = [
  // Joyful, joyful, we adore thee / God of glory, Lord of love
  'Joy-', 'ful,', 'joy-', 'ful,', 'we', 'a-', 'dore', 'thee,',
  'God', 'of', 'glo-', 'ry,', 'Lord', 'of', 'love;',
  // Hearts unfold like flow'rs before thee / Op'ning to the sun above
  'Hearts', 'un-', 'fold', 'like', "flow'rs", 'be-', 'fore', 'thee,',
  'Op-', "'ning", 'to', 'the', 'sun', 'a-', 'bove.',
  // Melt the clouds of sin and sadness / drive the dark of doubt away
  'Melt', 'the', 'clouds', 'of', 'sin', 'and', 'sad-', 'ness', '',
  'drive', 'the', 'dark', 'of', 'doubt', 'a-', 'way.', '',
  // Giver of immortal gladness / fill us with the light of day
  'Giv-', 'er', 'of', 'im-', 'mor-', 'tal', 'glad-', 'ness,',
  'fill', 'us', 'with', 'the', 'light', 'of', 'day!',
];

const odeToJoy: ScoreSpec = {
  title: 'Ode to Joy',
  composer: 'Beethoven · SATB setting for ClefNotes',
  fifths: 0,
  time: [4, 4],
  bpm: 96,
  parts: [
    {
      name: 'Soprano',
      abbrev: 'S',
      clef: 'G2',
      lyrics: ODE_LYRICS,
      notes: `
        E4 E4 F4 G4    G4 F4 E4 D4    C4 C4 D4 E4    E4:q. D4:e D4:h
        E4 E4 F4 G4    G4 F4 E4 D4    C4 C4 D4 E4    D4:q. C4:e C4:h
        D4 D4 E4 C4    D4 E4:e F4:e E4 C4    D4 E4:e F4:e E4 D4    C4 D4 G3:h
        E4 E4 F4 G4    G4 F4 E4 D4    C4 C4 D4 E4    D4:q. C4:e C4:h`,
    },
    {
      name: 'Alto',
      abbrev: 'A',
      clef: 'G2',
      lyrics: ODE_LYRICS,
      notes: `
        C4 C4 C4 E4    E4 C4 C4 B3    G3 A3 B3 C4    C4:q. B3:e B3:h
        C4 C4 C4 E4    E4 C4 C4 B3    G3 A3 B3 C4    B3:q. G3:e G3:h
        B3 B3 C4 G3    B3 C4:e C4:e C4 A3    B3 C4:e C4:e C4 B3    G3 B3 B3:h
        C4 C4 C4 E4    E4 C4 C4 B3    G3 A3 B3 C4    B3:q. G3:e G3:h`,
    },
    {
      name: 'Tenor',
      abbrev: 'T',
      clef: 'G2-8',
      lyrics: ODE_LYRICS,
      notes: `
        G3 G3 A3 G3    G3 A3 G3 G3    E3 E3 G3 G3    G3:q. G3:e G3:h
        G3 G3 A3 G3    G3 A3 G3 G3    E3 E3 G3 G3    G3:q. E3:e E3:h
        G3 G3 G3 E3    G3 G3:e G3:e G3 F3    G3 G3:e G3:e G3 G3    E3 G3 D3:h
        G3 G3 A3 G3    G3 A3 G3 G3    E3 E3 G3 G3    G3:q. E3:e E3:h`,
    },
    {
      name: 'Bass',
      abbrev: 'B',
      clef: 'F4',
      lyrics: ODE_LYRICS,
      notes: `
        C3 C3 F2 C3    C3 F2 C3 G2    C3 A2 G2 C3    C3:q. G2:e G2:h
        C3 C3 F2 C3    C3 F2 C3 G2    C3 A2 G2 C3    G2:q. C3:e C3:h
        G2 G2 C3 C3    G2 C3:e C3:e C3 F2    G2 C3:e C3:e C3 G2    C3 G2 G2:h
        C3 C3 F2 C3    C3 F2 C3 G2    C3 A2 G2 C3    G2:q. C3:e C3:h`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Frère Jacques — four-part round. Each voice is the same melody entering two
// bars apart, which makes it the clearest possible demo of part isolation:
// solo any voice and you hear one line; unmute them and the canon locks in.
// ---------------------------------------------------------------------------

const FRERE_MELODY = `
  C4 D4 E4 C4    C4 D4 E4 C4
  E4 F4 G4:h     E4 F4 G4:h
  G4:e A4:e G4:e F4:e E4 C4    G4:e A4:e G4:e F4:e E4 C4
  C4 G3 C4:h     C4 G3 C4:h`;

const FRERE_LYRICS = [
  'Are', 'you', 'sleep-', 'ing,', 'are', 'you', 'sleep-', 'ing,',
  'Broth-', 'er', 'John,', 'Broth-', 'er', 'John,',
  'Morn-', 'ing', 'bells', 'are', 'ring-', 'ing,', 'Morn-', 'ing', 'bells', 'are', 'ring-', 'ing,',
  'Ding', 'dang', 'dong,', 'Ding', 'dang', 'dong.',
];

const frereJacques: ScoreSpec = {
  title: 'Frère Jacques',
  composer: 'Traditional · four-part round',
  fifths: 0,
  time: [4, 4],
  bpm: 104,
  parts: [0, 1, 2, 3].map((i) => ({
    name: `Voice ${i + 1}`,
    abbrev: `V${i + 1}`,
    clef: (i < 2 ? 'G2' : i === 2 ? 'G2-8' : 'F4') as 'G2' | 'G2-8' | 'F4',
    notes: FRERE_MELODY,
    lyrics: FRERE_LYRICS,
    // Voices 3 and 4 sing an octave down so the round sits in a choir's range.
    transpose: i >= 2 ? -12 : 0,
    offsetQ: i * 8,
  })),
};

// ---------------------------------------------------------------------------
// Row, Row, Row Your Boat — three-part round in 6/8.
// ---------------------------------------------------------------------------

const ROW_MELODY = `
  C4:q. C4:q.
  C4:q D4:e E4:q.
  E4:q D4:e E4:q F4:e
  G4:h.
  C5:e C5:e C5:e G4:e G4:e G4:e
  E4:e E4:e E4:e C4:e C4:e C4:e
  G4:q F4:e E4:q D4:e
  C4:h.`;

const ROW_LYRICS = [
  'Row,', 'row,', 'row', 'your', 'boat,', 'Gent-', 'ly', 'down', 'the', 'stream,',
  'Mer-', 'ri-', 'ly,', 'mer-', 'ri-', 'ly,', 'mer-', 'ri-', 'ly,', 'mer-', 'ri-', 'ly,',
  'Life', 'is', 'but', 'a', 'dream.',
];

const rowYourBoat: ScoreSpec = {
  title: 'Row, Row, Row Your Boat',
  composer: 'Traditional · three-part round',
  fifths: 0,
  time: [6, 8],
  bpm: 108,
  parts: [0, 1, 2].map((i) => ({
    name: `Voice ${i + 1}`,
    abbrev: `V${i + 1}`,
    clef: (i < 2 ? 'G2' : 'F4') as 'G2' | 'F4',
    notes: ROW_MELODY,
    lyrics: ROW_LYRICS,
    transpose: i === 2 ? -12 : 0,
    offsetQ: i * 6,
  })),
};

// ---------------------------------------------------------------------------
// Twinkle, Twinkle — melody and bass. The gentlest possible first score,
// and the one used for the "your first score" walkthrough.
// ---------------------------------------------------------------------------

const twinkle: ScoreSpec = {
  title: 'Twinkle, Twinkle, Little Star',
  composer: 'Traditional · words by Jane Taylor',
  fifths: 0,
  time: [4, 4],
  bpm: 92,
  parts: [
    {
      name: 'Melody',
      abbrev: 'Mel',
      clef: 'G2',
      lyrics: [
        'Twin-', 'kle,', 'twin-', 'kle,', 'lit-', 'tle', 'star,',
        'How', 'I', 'won-', 'der', 'what', 'you', 'are!',
        'Up', 'a-', 'bove', 'the', 'world', 'so', 'high,',
        'Like', 'a', 'dia-', 'mond', 'in', 'the', 'sky.',
        'Twin-', 'kle,', 'twin-', 'kle,', 'lit-', 'tle', 'star,',
        'How', 'I', 'won-', 'der', 'what', 'you', 'are!',
      ],
      notes: `
        C4 C4 G4 G4    A4 A4 G4:h    F4 F4 E4 E4    D4 D4 C4:h
        G4 G4 F4 F4    E4 E4 D4:h    G4 G4 F4 F4    E4 E4 D4:h
        C4 C4 G4 G4    A4 A4 G4:h    F4 F4 E4 E4    D4 D4 C4:h`,
    },
    {
      name: 'Bass',
      abbrev: 'B',
      clef: 'F4',
      notes: `
        C3 C3 C3 C3    F2 F2 C3:h    F2 F2 C3 C3    G2 G2 C3:h
        C3 C3 F2 F2    C3 C3 G2:h    C3 C3 F2 F2    C3 C3 G2:h
        C3 C3 C3 C3    F2 F2 C3:h    F2 F2 C3 C3    G2 G2 C3:h`,
    },
  ],
};

export const SHELF: ShelfEntry[] = [
  {
    slug: 'ode-to-joy-satb',
    spec: odeToJoy,
    blurb: 'Four voices, one lyric line, a full chorale.',
    showcases: 'SATB learning tracks · ClefVox',
  },
  {
    slug: 'frere-jacques-round',
    spec: frereJacques,
    blurb: 'The same tune four times over, two bars apart.',
    showcases: 'Solo one part and hear it clearly',
  },
  {
    slug: 'row-your-boat-round',
    spec: rowYourBoat,
    blurb: 'A three-part round in 6/8.',
    showcases: 'Compound time · minus-one mode',
  },
  {
    slug: 'twinkle-duet',
    spec: twinkle,
    blurb: 'Melody and bass. The gentlest place to start.',
    showcases: 'Note highlighting · tempo control',
  },
];

const xmlCache = new Map<string, string>();

/** Compile a shelf entry to MusicXML, memoised. */
export function shelfXml(entry: ShelfEntry): string {
  let xml = xmlCache.get(entry.slug);
  if (!xml) {
    xml = buildMusicXml(entry.spec);
    xmlCache.set(entry.slug, xml);
  }
  return xml;
}
